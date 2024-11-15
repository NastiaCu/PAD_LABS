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
import consul
import os
import uuid
from prometheus_fastapi_instrumentator import Instrumentator

INSTANCE_ID = os.environ.get('INSTANCE_ID', '1')

redis_client = redis.Redis(host="redis", port=6379, decode_responses=True)

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

instrumentator = Instrumentator()
instrumentator.instrument(app).expose(app)

def register_with_consul():
    c = consul.Consul(host='consul', port=8500)
    instance_uuid = f"recommendation-service-{uuid.uuid4()}"

    c.agent.service.register(
        name='recommendation-service',
        service_id=instance_uuid,
        address='recommendation_service',
        port=8001,
        tags=["posts"]
    )
    print(f"Registered recommendation-service with Consul as {instance_uuid}")

@app.on_event("startup")
async def startup_event():
    register_with_consul()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/api/posts/", response_model=schemas.Post)
async def create_post(post: schemas.PostCreate, db: Session = Depends(get_db)):
    try:
        result = await asyncio.wait_for(crud.create_post_async(db, post), timeout=3)
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Task Timeout: The request took too long to process.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Retrieve all posts.
@app.get("/api/posts")
async def get_posts(db: Session = Depends(get_db)):
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

# Service status
@app.get("/status")
def status():
    return {"status": f"Post service instance {INSTANCE_ID} is running"}
