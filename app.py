from fastapi import FastAPI, WebSocket
import uvicorn
from Brain.RTC import RTC
from dotenv import load_dotenv
import tracemalloc
import subprocess

load_dotenv()
tracemalloc.start()

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    rtc = RTC()
    await rtc.run(websocket)

def start_frontend():
    # Start Electron frontend as a subprocess
    subprocess.Popen(["npm", "start"], cwd="./frontend/", shell=True)

if __name__ == "__main__":
    start_frontend()
    uvicorn.run(app, host="0.0.0.0", port=8000)