from pymongo import MongoClient
import random
import string
import numpy as np

random.seed(42)
np.random.seed(42)

client = MongoClient("mongodb+srv://xing:Test123456@xing-test-indexadvisor.global.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000")
db = client["index_advisor_test"]

# ============================================================
# Equality filter — missing index
# ============================================================
# Description: equality filter on "user_id" without index.
coll = db["a"]
if coll.estimated_document_count() == 0:
    docs = [{"user_id": random.randint(1, 5000), "name": ''.join(random.choices(string.ascii_lowercase, k=5))} for _ in range(10000)]
    coll.insert_many(docs)
    print("Equality filter collection created with sample data.")


# ============================================================
# Range query — missing index
# ============================================================
# Description: range filter on "age" without index.
coll = db["b"]
if coll.estimated_document_count() == 0:
    docs = [{"user_id": i, "age": random.randint(18, 70)} for i in range(20000)]
    coll.insert_many(docs)
    print("Range query collection created with sample data.")


# ============================================================
# Compound filter — missing or non-matching index
# ============================================================
# Description: compound filter on "country" and "city" without proper index.
coll = db["c"]
if coll.estimated_document_count() == 0:
    coll.create_index([("country", 1)])  # Index on only "country"
    countries = ["US", "CN", "JP", "UK", "FR"]
    cities = ["NY", "SF", "BJ", "TK", "LD", "PA"]
    docs = [{"country": random.choice(countries), "city": random.choice(cities), "pop": random.randint(1000, 1000000)} for _ in range(30000)]
    coll.insert_many(docs)
    print("Compound filter collection created with sample data.")


# ============================================================
# Sort query — missing composite index
# ============================================================
# Description: find with sort on "score" and "timestamp" without composite index.
coll = db["d"]
if coll.estimated_document_count() == 0:
    docs = [{"score": random.randint(0, 100), "timestamp": random.randint(1600000000, 1700000000)} for _ in range(20000)]
    coll.insert_many(docs)
    print("Sort query collection created with sample data.")


# ============================================================
# Aggregation with sort — missing composite index
# ============================================================
# Description: aggregation with $match + $sort on "category" and "price".
coll = db["e"]
if coll.estimated_document_count() == 0:
    coll.create_index([("price", 1)]) # Index on only "price"
    categories = ["A", "B", "C", "D"]
    docs = [{"category": random.choice(categories), "price": random.randint(10, 1000)} for _ in range(20000)]
    coll.insert_many(docs)
    print("Aggregation with sort collection created with sample data.")


# ============================================================
# Low selectivity field
# ============================================================
# Description: equality filter on low-cardinality field.
coll = db["f"]
if coll.estimated_document_count() == 0:
    coll.create_index([("gender", 1)]) # Index on "gender"
    docs = [{"user_id": i, "gender": "F"} for i in range(50000)]
    coll.insert_many(docs)
    print("Low selectivity collection created with sample data.")


# ============================================================
# Small collection
# ============================================================
# Description: small dataset where index is unnecessary.
coll = db["g"]
if coll.estimated_document_count() == 0:
    coll.create_index([("flag", 1)]) # Index on "flag"
    docs = [{"flag": random.choice([True, False]), "value": random.randint(1, 100)} for _ in range(50)]
    coll.insert_many(docs)
    print("Small collection created with sample data.")


print("All test data prepared successfully.")
