import random
import string
from pymongo import MongoClient
from dotenv import load_dotenv
import os

load_dotenv()
DOCUMENTDB_URI = os.getenv("DOCUMENTDB_URI", "mongodb://localhost:27017")

def generate_data(n=10000):
    data = []
    for _ in range(n):
        doc = {
            "a": random.randint(1, 100000),
            "b": random.choice(string.ascii_lowercase),
            "c": random.choice([True, False]),
            "d": random.choice(string.ascii_uppercase)
        }
        data.append(doc)
    return data

def prepare_collections(uri=DOCUMENTDB_URI, db_name="index_advisor"):
    client = MongoClient(uri)
    db = client[db_name]

    collections = [
        "s_0", "s_1", "s_2", "s_3", "s_4"
    ]

    for coll in collections:
        db[coll].drop()

    docs = generate_data(10000)

    for coll in collections:
        db[coll].insert_many(docs)

    db["s_1"].create_index("b")                 
    db["s_2"].create_index("a")              
    db["s_2"].create_index("b")               
    db["s_3"].create_index([("a", 1), ("b", 1)])
    db["s_4"].create_index([("a", 1), ("b", 1), ("d", 1)])

    print("Data preparation complete.")

if __name__ == "__main__":
    prepare_collections()
