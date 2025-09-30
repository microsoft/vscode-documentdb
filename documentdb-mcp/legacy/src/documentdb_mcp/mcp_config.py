import os

from dotenv import load_dotenv

load_dotenv()

TRANSPORT = os.getenv("TRANSPORT", "streamable-http")
HOST = os.getenv("HOST", "localhost")
PORT = int(os.getenv("PORT", "8070"))
DOCUMENTDB_URI = os.getenv("DOCUMENTDB_URI", "mongodb://localhost:27017")