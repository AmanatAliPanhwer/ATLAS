from fastapi import FastAPI, WebSocket
import uvicorn
from Brain.RTC import RTC
from dotenv import load_dotenv
import tracemalloc

load_dotenv('.env')
tracemalloc.start()

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    rtc = RTC()
    await rtc.run(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)