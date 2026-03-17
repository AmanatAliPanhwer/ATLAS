import os
import asyncio
import base64
import io
import traceback


import cv2
import pyaudio
import PIL.Image

from google import genai
from google.genai import types
from google.genai.types import Type

from Database.prompts import RTC_prompt
from Brain.deepagent import DeepAgent

FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024

MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025"

DEFAULT_MODE = "camera"

client = genai.Client(
    http_options={"api_version": "v1alpha"},
    api_key=os.environ.get("GEMINI_API_KEY"),
)



tools = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name = "DeepAgent",
                behavior = "NON_BLOCKING",
                parameters=genai.types.Schema(
                    type = genai.types.Type.OBJECT,
                    properties = {
                        "query": genai.types.Schema(
                            type = genai.types.Type.STRING,
                        ),
                    },
                ),
            ),
        ]
    ),
    types.Tool(google_search=types.GoogleSearch())
]

CONFIG = types.LiveConnectConfig(
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
        parts=[types.Part.from_text(text=RTC_prompt)],
        role="user"
    ),
    tools=tools,
    output_audio_transcription = {},
    input_audio_transcription = {},
    enable_affective_dialog = True,
    proactivity={'proactive_audio': True},
)

pya = pyaudio.PyAudio()


class AudioLoop:
    def __init__(self, video_mode=DEFAULT_MODE):
        self.video_mode = video_mode

        self.audio_in_queue = None
        self.out_queue = None

        self.session = None

        self.send_text_task = None
        self.receive_audio_task = None
        self.play_audio_task = None

        self.audio_stream = None
        self.deepagent = None

    async def send_text(self):
        while True:
            text = await asyncio.to_thread(
                input,
                "message > ",
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
        # Fix: Convert BGR to RGB color space
        # OpenCV captures in BGR but PIL expects RGB format
        # This prevents the blue tint in the video feed
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = PIL.Image.fromarray(frame_rgb)  # Now using RGB frame
        img.thumbnail([1024, 1024])

        image_io = io.BytesIO()
        img.save(image_io, format="jpeg")
        image_io.seek(0)

        mime_type = "image/jpeg"
        image_bytes = image_io.read()
        return {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}

    async def get_frames(self):
        # This takes about a second, and will block the whole program
        # causing the audio pipeline to overflow if you don't to_thread it.
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
            raise ImportError("Please install mss package using 'pip install mss'") from e
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
        mic_info = pya.get_default_input_device_info()
        self.audio_stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=CHUNK_SIZE,
        )
        if __debug__:
            kwargs = {"exception_on_overflow": False}
        else:
            kwargs = {}
        while True:
            data = await asyncio.to_thread(self.audio_stream.read, CHUNK_SIZE, **kwargs)
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
            function_response = types.FunctionResponse(
                id=fc.id,
                name=fc.name,
                scheduling=types.FunctionResponseScheduling.WHEN_IDLE,
                response={"result": result}
            )
            function_responses.append(function_response)

        await self.session.send_tool_response(function_responses=function_responses)

    async def receive_audio(self):
        "Background task to reads from the websocket and write pcm chunks to the output queue"
        try:
            while True:
                if self.session is not None:
                    turn = self.session.receive()
                    input_transcription = ""
                    output_transcription = ""
                    async for response in turn:
                        if data := response.data:
                            self.audio_in_queue.put_nowait(data)
                            continue
                        elif response.tool_call:
                            asyncio.create_task(self._hendle_tool_calls(response.tool_call))
                            continue
                        if text := response.text:
                            print(text, end="")
                        if response.server_content and response.server_content.output_transcription:
                            output_transcription += response.server_content.output_transcription.text
                        if response.server_content and response.server_content.input_transcription:
                            input_transcription += response.server_content.input_transcription.text
                    print(f"User: {input_transcription}")
                    print(f"ATLAS: {output_transcription}")

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
                    print("Transcript:", response.server_content.output_transcription.text)

    async def play_audio(self):
        stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
        )
        while True:
            if self.audio_in_queue is not None:
                bytestream = await self.audio_in_queue.get()
                await asyncio.to_thread(stream.write, bytestream)

    async def run(self):
        try:
            async with (
                client.aio.live.connect(model=MODEL, config=CONFIG) as session,
                asyncio.TaskGroup() as tg,
            ):
                self.session = session
                self.deepagent = DeepAgent(session=self.session)

                self.audio_in_queue = asyncio.Queue()
                self.out_queue = asyncio.Queue(maxsize=5)

                send_text_task = tg.create_task(self.send_text())
                tg.create_task(self.send_realtime())
                tg.create_task(self.listen_audio())
                if self.video_mode == "camera":
                    tg.create_task(self.get_frames())
                elif self.video_mode == "screen":
                    tg.create_task(self.get_screen())

                tg.create_task(self.receive_audio())
                # tg.create_task(self.receive_text())
                tg.create_task(self.play_audio())

                await send_text_task
                raise asyncio.CancelledError("User requested exit")

        except* asyncio.CancelledError:
            pass
        except* Exception as EG:
            if self.audio_stream is not None:
                self.audio_stream.close()
                traceback.print_exception(EG)