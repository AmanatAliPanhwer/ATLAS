import os
import asyncio
import base64
import io
import traceback
import requests
from fastapi import WebSocket, WebSocketDisconnect

import cv2
import pyaudio
import PIL.Image

from google import genai
from google.genai import types

from Database.prompts import RTC_prompt
from Brain.deepagent import DeepAgent
from Brain.RAG import RAG

from dotenv import load_dotenv
load_dotenv()

class RTC:
    def __init__(
        self,
        model: str = "models/gemini-2.5-flash-native-audio-preview-12-2025",
        video_mode: str = "camera",
        session_id: str = "default",
    ):
        self.FORMAT = pyaudio.paInt16
        self.CHANNELS = 1
        self.SEND_SAMPLE_RATE = 16000
        self.RECEIVE_SAMPLE_RATE = 24000
        self.CHUNK_SIZE = 1024

        self.model = model

        self.video_mode = video_mode

        self.session_id = session_id
        self.memory = RAG(session_id=self.session_id)
        self._pending_user_text = ""  # buffer: accumulates user transcription
        self._pending_assistant_text = ""  # buffer: accumulates assistant transcription

        self.client = genai.Client(
            http_options={"api_version": "v1alpha"},
            api_key=os.environ.get("GEMINI_API_KEY"),
        )

        self.tools = [
            types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name="DeepAgent",
                        behavior="NON_BLOCKING",
                        parameters=genai.types.Schema(
                            type=genai.types.Type.OBJECT,
                            properties={
                                "query": genai.types.Schema(
                                    type=genai.types.Type.STRING,
                                ),
                            },
                        ),
                    ),
                ]
            ),
            types.Tool(google_search=types.GoogleSearch()),
            types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name="GetContext",
                        parameters=genai.types.Schema(
                            type=genai.types.Type.OBJECT,
                            properties={
                                "query": genai.types.Schema(
                                    type=genai.types.Type.STRING,
                                ),
                            },
                        ),
                    ),
                ]
            ),
        ]

        self.CONFIG = types.LiveConnectConfig(
            response_modalities=[
                "AUDIO",
            ],
            media_resolution="MEDIA_RESOLUTION_MEDIUM",
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Orus")
                )
            ),
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=104857,
                sliding_window=types.SlidingWindow(target_tokens=52428),
            ),
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=RTC_prompt)], role="user"
            ),
            tools=self.tools,
            output_audio_transcription={},
            input_audio_transcription={},
            enable_affective_dialog=True,
            proactivity={"proactive_audio": True},
        )

        self.pya = pyaudio.PyAudio()

        self.audio_in_queue = None
        self.out_queue = None

        self.session = None

        self.send_text_task = None
        self.receive_audio_task = None
        self.play_audio_task = None

        self.audio_stream = None
        self.deepagent = None
        
        # API communication
        self.api_url = "http://localhost:3000/{state}"
        self.current_state = "idle"

    def build_rag_injection(self, query: str) -> str:
        """
        Retrieve relevant past conversation turns from ChromaDB
        and format them as a context block for the model.
        """
        context = self.memory.retrieve_context(query)
        print(f"[RAG] Retrieved context for query '{query}':\n{context}")
        if not context:
            return ""
        return (
            "\n\n[MEMORY — relevant past conversation]\n" + context + "\n[END MEMORY]\n"
        )

    async def update_frontend_state(self, mode: str) -> None:
        """
        Send state update to frontend via API in a separate thread.
        Non-blocking to prevent interrupting the main audio processing.

        Args:
            mode: One of 'idle', 'listening', 'thinking', 'speaking'
        """
        if mode == self.current_state:
            return  # No state change, skip API call
        
        # Run HTTP request in thread pool to avoid blocking the main async loop
        await asyncio.to_thread(self._send_state_request, mode)
    
    def _send_state_request(self, mode: str) -> None:
        """
        Internal method that makes the actual HTTP request.
        Runs in a separate thread via asyncio.to_thread.
        """
        try:
            response = requests.post(
                self.api_url.format(state=mode),
                json={"state": "on"},
                timeout=2
            )
            if response.status_code == 200:
                self.current_state = mode
                print(f"[FRONTEND] State updated to: {mode}")
            else:
                print(f"[FRONTEND] Failed to update state: {response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"[FRONTEND] API connection error: {e}")

    def _flush_turn_to_memory(self):
        """
        After a full exchange (user + ATLAS transcriptions collected),
        save both to ChromaDB and reset buffers.
        """
        self.memory.save_exchange(
            user_text=self._pending_user_text,
            assistant_text=self._pending_assistant_text,
        )
        if self._pending_user_text or self._pending_assistant_text:
            print(
                f"[RAG] Saved turn → "
                f"User: {self._pending_user_text[:60]}... | "
                f"ATLAS: {self._pending_assistant_text[:60]}..."
            )
        self._pending_user_text = ""
        self._pending_assistant_text = ""

    async def send_text(self):
        while True:
            text = await asyncio.to_thread(
                input,
                "message > \n",
            )
            if text.lower() == "q":
                break
            if self.session is not None:
                await self.session.send(input=text or ".", end_of_turn=True)

    def _get_frame(self, cap):
        # Read the frameq
        ret, frame = cap.read()
        # Check if the frame was read successfully
        if not ret:
            return None
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)
        img.thumbnail([1024, 1024])

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)

        mime_type = "image/jpeg"
        image_bytes = image_io.read()
        return {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}

    async def get_frames(self):

        cap = await asyncio.to_thread(
            cv2.VideoCapture, 0
        )  # 0 represents the default camera

        while True:
            frame = await asyncio.to_thread(self._get_frame, cap)
            if frame is None:
                break

            await asyncio.sleep(1.0)

            if self.out_queue is not None:
                await self.out_queue.put(frame)

        # Release the VideoCapture object
        cap.release()

    def _get_screen(self):
        try:
            import mss  # pytype: disable=import-error # pylint: disable=g-import-not-at-top
        except ImportError as e:
            raise ImportError(
                "Please install mss package using 'pip install mss'"
            ) from e
        sct = mss.mss()
        monitor = sct.monitors[0]

        i = sct.grab(monitor)

        mime_type = "image/jpeg"
        image_bytes = mss.tools.to_png(i.rgb, i.size)
        img = PIL.Image.open(io.BytesIO(image_bytes))

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)

        image_bytes = image_io.read()
        return {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}

    async def get_screen(self):
        while True:
            frame = await asyncio.to_thread(self._get_screen)
            if frame is None:
                break

            await asyncio.sleep(1.0)

            if self.out_queue is not None:
                await self.out_queue.put(frame)

    async def send_realtime(self):
        while True:
            if self.out_queue is not None:
                msg = await self.out_queue.get()
                if self.session is not None:
                    await self.session.send(input=msg)

    async def listen_audio(self):
        mic_info = self.pya.get_default_input_device_info()
        self.audio_stream = await asyncio.to_thread(
            self.pya.open,
            format=self.FORMAT,
            channels=self.CHANNELS,
            rate=self.SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=self.CHUNK_SIZE,
        )
        if __debug__:
            kwargs = {"exception_on_overflow": False}
        else:
            kwargs = {}
        
        
        while True:
            data = await asyncio.to_thread(
                self.audio_stream.read, self.CHUNK_SIZE, **kwargs
            )
            if self.out_queue is not None:
                await self.out_queue.put({"data": data, "mime_type": "audio/pcm"})

    async def _hendle_tool_calls(self, tool_call):
        print("The tool was called")
        function_responses = []
        for fc in tool_call.function_calls:
            result = ""
            if fc.name == "DeepAgent":
                query = fc.args.get("query", "")
                result = await self.deepagent.query(query)
            if fc.name == "GetContext":
                query = fc.args.get("query", "")
                result = self.build_rag_injection(query)
            scheduling = (
                types.FunctionResponseScheduling.INTERRUPT
                if fc.name == "GetContext"
                else types.FunctionResponseScheduling.WHEN_IDLE
            )
            function_response = types.FunctionResponse(
                id=fc.id,
                name=fc.name,
                scheduling=scheduling,
                response={"result": result},
            )
            function_responses.append(function_response)

        await self.session.send_tool_response(function_responses=function_responses)

    async def receive_audio(self, websocket: WebSocket):
        "Background task to reads from the websocket and write pcm chunks to the output queue"
        try:
            while True:
                if self.session is not None:
                    turn = self.session.receive()
                    input_transcription = ""
                    output_transcription = ""

                    async for response in turn:
                        
                        if data := response.data:
                            b64_audio = base64.b64encode(data).decode('utf-8')
                            await websocket.send_json({
                                "serverContent": {
                                    "modelTurn": {
                                        "parts": [{"inlineData": {"data": b64_audio, "mimeType": "audio/pcm"}}]
                                    }
                                }
                            })
                            await self.update_frontend_state("speaking")
                            continue
                        elif response.tool_call:
                            asyncio.create_task(
                                self._hendle_tool_calls(response.tool_call)
                            )
                            continue
                        if text := response.text:
                            print(text, end="")
                        
                        if response.server_content:
                            if response.server_content.output_transcription:
                                text = response.server_content.output_transcription.text
                                await websocket.send_json({
                                    "serverContent": {
                                        "outputTranscription": {"text": text}
                                    }
                                })
                                output_transcription += text
                            if response.server_content.input_transcription:
                                
                                text = response.server_content.input_transcription.text
                                await websocket.send_json({
                                    "serverContent": {
                                        "inputTranscription": {"text": text}
                                    }
                                })
                                input_transcription += text
                            if response.server_content.turn_complete:
                                await websocket.send_json({
                                    "serverContent": {
                                        "turnComplete": True
                                    }       
                                })
                            if response.server_content.interrupted:
                                await websocket.send_json({
                                    "serverContent": {
                                        "interrupted": True
                                    }       
                                })

                    print(f"User: {input_transcription}")
                    print(f"ATLAS: {output_transcription}")

                    self._pending_user_text += (" " + input_transcription).strip()
                    self._pending_assistant_text += (" " + output_transcription).strip()
                    self._flush_turn_to_memory()
                    
                    # Return to listening after turn completes (non-blocking)
                    asyncio.create_task(self.update_frontend_state("idle"))

                    while not self.audio_in_queue.empty():
                        self.audio_in_queue.get_nowait()

        except Exception as e:
            print(e)

    async def receive_text(self):
        while True:
            async for response in self.session.receive():
                if response.server_content.model_turn:
                    print("Model turn:", response.server_content.model_turn)
                if response.server_content.output_transcription:
                    print(
                        "Transcript:", response.server_content.output_transcription.text
                    )

    async def play_audio(self):
        stream = await asyncio.to_thread(
            self.pya.open,
            format=self.FORMAT,
            channels=self.CHANNELS,
            rate=self.RECEIVE_SAMPLE_RATE,
            output=True,
        )
        while True:
            if self.audio_in_queue is not None:
                bytestream = await self.audio_in_queue.get()
                await asyncio.to_thread(stream.write, bytestream)
    
    async def receive_from_electron(self, websocket: WebSocket):
        """Reads data from the Electron Microphone/Input"""
        try:
            while True:
                msg = await websocket.receive_json()
                if msg["type"] == "audio":
                    raw_audio = base64.b64decode(msg["data"])
                    await self.session.send(input={"data": raw_audio, "mime_type": "audio/pcm"}, end_of_turn=False)
                elif msg["type"] == "text":
                    await self.session.send(input=msg["text"], end_of_turn=True)
                elif msg["type"] == "video":
                    raw_video = base64.b64decode(msg["data"])
                    await self.session.send(input={"data": raw_video, "mime_type": "image/jpeg"}, end_of_turn=False)
        except WebSocketDisconnect:
            print("[WS] Electron Disconnected")

    async def run(self, websocket: WebSocket):
        try:
            async with (
                self.client.aio.live.connect(
                    model=self.model, config=self.CONFIG
                ) as session,
                asyncio.TaskGroup() as tg,
            ):
                self.session = session
                self.deepagent = DeepAgent(session=self.session)

                self.audio_in_queue = asyncio.Queue()
                self.out_queue = asyncio.Queue(maxsize=5)

                send_text_task = tg.create_task(self.send_text())
                tg.create_task(self.receive_audio(websocket))
                tg.create_task(self.receive_from_electron(websocket))

                await send_text_task
                raise asyncio.CancelledError("User requested exit")

        except* asyncio.CancelledError:
            pass
        except* Exception as EG:
            if self.audio_stream is not None:
                self.audio_stream.close()
                traceback.print_exception(EG)
        finally:
            # Set state to idle when system shuts down (non-blocking fire-and-forget)
            asyncio.create_task(self.update_frontend_state("idle"))
            if self.audio_stream is not None:
                self.audio_stream.close()
