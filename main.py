from dotenv import load_dotenv
import argparse
import os
import asyncio
import tracemalloc

load_dotenv()
tracemalloc.start()

from Brain.RTC import RTC


DEFAULT_MODE = "camera"

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        type=str,
        default=DEFAULT_MODE,
        help="pixels to stream from",
        choices=["camera", "screen", "none"],
    )
    args = parser.parse_args()
    main = RTC(video_mode=args.mode)
    asyncio.run(main.run())


