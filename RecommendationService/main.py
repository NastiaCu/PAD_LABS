from fastapi import FastAPI, WebSocket, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import models, schemas, crud
from database import SessionLocal, engine
from websocket_manager import WebSocketManager
import schemas
import json
import asyncio

import threading
import redis

# Redis setup
redis_client = redis.Redis(host="localhost", port=6379, decode_responses=True)

def redis_comment_listener():
    pubsub = redis_client.pubsub()
    pubsub.subscribe("comments_channel")

    for message in pubsub.listen():
        if message and message['type'] == 'message':
            print(f"New message from Redis: {message['data']}")

listener_thread = threading.Thread(target=redis_comment_listener)
listener_thread.daemon = True
listener_thread.start()

app = FastAPI()

models.Base.metadata.create_all(bind=engine)

ws_manager = WebSocketManager()

semaphore = asyncio.Semaphore(10)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Create a new car recommendation post.
@app.post("/api/posts/", response_model=schemas.Post)
def create_post(post: schemas.PostCreate, db: Session = Depends(get_db)):
    return crud.create_post(db=db, post=post)

# Retrieve all car recommendations.
@app.get("/api/posts")
async def get_posts(db: Session = Depends(get_db)):
    async with semaphore:
        posts = db.query(models.Post).all()
        return posts

# Retrieve a specific post by ID.
@app.get("/api/posts/{post_id}", response_model=schemas.Post)
def get_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return post

# Update a specific post by ID.
@app.put("/api/posts/{post_id}", response_model=dict)
def update_post(post_id: int, updated_post: schemas.PostCreate, db: Session = Depends(get_db)):
    post = crud.get_post(db, post_id=post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    
    post.title = updated_post.title
    post.content = updated_post.content
    post.car_model = updated_post.car_model
    db.commit()
    db.refresh(post)
    
    return {"message": "Post updated successfully"}

# Delete a specific post by ID.
@app.delete("/api/posts/{post_id}", response_model=dict)
def delete_post(post_id: int, db: Session = Depends(get_db)):
    post = crud.get_post(db, post_id=post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    
    crud.delete_post(db, post_id=post_id)
    
    return {"message": "Post deleted successfully"}

@app.websocket("/ws/api/comments")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            comment_data = json.loads(data)
            
            print(f"Publishing to Redis: {comment_data}")
            
            redis_client.publish("comments_channel", json.dumps(comment_data))
            
            await ws_manager.broadcast(f"New comment: {comment_data['content']} by user {comment_data['user_id']}")
    except Exception as e:
        await ws_manager.disconnect(websocket)

def redis_comment_listener():
    pubsub = redis_client.pubsub()
    pubsub.subscribe("comments_channel")
    
    for message in pubsub.listen():
        if message and message['type'] == 'message':
            print(f"New message from Redis: {message['data']}")

listener_thread = threading.Thread(target=redis_comment_listener)
listener_thread.daemon = True
listener_thread.start()

# Service status
@app.get("/status")
def status():
    return {"status": "Post service is running"}


@app.get("/process")
async def process_data():
    try:
        result = await asyncio.wait_for(some_long_task(), timeout=5)
        return {"result": result}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Request Timeout")
        
async def some_long_task():
    await asyncio.sleep(10)
    return "Task Completed"