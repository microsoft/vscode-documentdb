from pymongo import MongoClient
import random
from dotenv import load_dotenv
import os

load_dotenv()
DOCUMENTDB_URI = os.getenv("DOCUMENTDB_URI", "mongodb://localhost:27017")

client = MongoClient(DOCUMENTDB_URI)

product_db = client["product_db"]

categories = {
    "electronics": [
        {"product_id": 1, "name": "Laptop", "price": 1200},
        {"product_id": 2, "name": "Smartphone", "price": 800},
        {"product_id": 3, "name": "Headphones", "price": 150},
    ],
    "books": [
        {"product_id": 4, "name": "Python 101", "price": 40},
        {"product_id": 5, "name": "AI for Beginners", "price": 55},
        {"product_id": 6, "name": "Data Science Handbook", "price": 70},
    ],
    "clothing": [
        {"product_id": 7, "name": "T-shirt", "price": 20},
        {"product_id": 8, "name": "Jeans", "price": 60},
        {"product_id": 9, "name": "Sneakers", "price": 90},
    ]
}

for cat, products in categories.items():
    coll = product_db[cat]
    coll.drop()
    coll.insert_many(products)

print("✅ Inserted product data into product_db")


order_db = client["order_db"]

regions = ["us", "eu", "asia"]

def generate_orders(region, num_orders=5):
    orders = []
    for i in range(num_orders):
        order = {
            "order_id": f"{region.upper()}_{i+1}",
            "user_id": random.randint(1000, 2000),
            "products": [
                {
                    "product_id": random.randint(1, 9),
                    "quantity": random.randint(1, 5)
                }
                for _ in range(random.randint(1, 3))
            ],
            "total_amount": 0,
        }
        order["total_amount"] = sum(
            [p["quantity"] * random.randint(20, 1200) for p in order["products"]]
        )
        orders.append(order)
    return orders

for region in regions:
    coll = order_db[region]
    coll.drop()
    coll.insert_many(generate_orders(region))

print("✅ Inserted order data into order_db")

print("\nDemo setup complete!")
