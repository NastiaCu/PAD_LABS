from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
import models, schemas
from database import SessionLocal, engine
import auth
import requests 
import asyncio
import consul

semaphore = asyncio.Semaphore(10)

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

def register_with_consul():
    c = consul.Consul(host='consul', port=8500)
    service_id = 'user-service'

    c.agent.service.register(
        name='user-service',
        service_id=service_id,
        address='user_service',
        port=8000,
        tags=["users"]
    )
    print(f"Registered user-service with Consul as {service_id}")

@app.on_event("startup")
async def startup_event():
    register_with_consul()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Register a new user.
@app.post("/api/users/register", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    user_in_db = models.get_user_by_email(db, user.email)
    if user_in_db:
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = models.create_user(db=db, user=user)
    return new_user

# Authenticate user and issue JWT.
@app.post("/api/users/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    user_in_db = auth.authenticate_user(db, user.email, user.password)
    if not user_in_db:
        raise HTTPException(status_code=400, detail="Invalid credentials")
    token = auth.create_access_token(data={"sub": user.email})
    return {"token": token}

# Get authenticated user's profile.
@app.get("/api/users/me", response_model=schemas.UserResponse)
def get_profile(current_user: schemas.User = Depends(auth.get_current_user)):
    return current_user

# Update the authenticated user's profile.
@app.put("/api/users/me", response_model=dict)
def update_profile(
    updated_user: schemas.UserUpdate, 
    current_user: schemas.User = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    updated_user_data = models.update_user_profile(db, user_id=current_user.id, updated_user=updated_user)
    if not updated_user_data:
        raise HTTPException(status_code=400, detail="Failed to update profile")
    return {"message": "Profile updated successfully"}

# Get a user's profile by user ID.
@app.get("/api/users/{user_id}", response_model=schemas.UserResponse)
def get_user_by_id(user_id: int, db: Session = Depends(get_db)):
    user = models.get_user_by_id(db, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.post("/api/users/{user_id}/posts")
def create_post_for_user(user_id: int, post: schemas.PostCreate, db: Session = Depends(get_db)):
    user = models.get_user_by_id(db, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    new_post = create_user_post(user_id, post.dict())
    return new_post

@app.get("/api/users/{user_id}/posts")
async def get_posts_for_user(user_id: int, db: Session = Depends(get_db)):
    async with semaphore:
        user = models.get_user_by_id(db, user_id=user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        posts = get_user_posts(user_id)
        return {"user": user, "posts": posts}

def get_user_posts(user_id: int):
    try:
        response = requests.get(f"http://localhost:3000/api/posts/?user_id={user_id}", timeout=5)
        if response.status_code == 200:
            return response.json()
    except requests.Timeout:
        raise HTTPException(status_code=500, detail="Post service request timed out")
    return None

def create_user_post(user_id: int, post_data: dict):
    try:
        post_service_url = "http://localhost:8001/api/posts/"
        post_data["user_id"] = user_id
        response = requests.post(post_service_url, json=post_data, timeout=5)
        if response.status_code == 201:
            return response.json()
    except requests.Timeout:
        raise HTTPException(status_code=500, detail="Post service request timed out")
    raise HTTPException(status_code=500, detail="Failed to create post")

@app.post("/api/users/{user_id}/posts")
def create_post_for_user(user_id: int, post: schemas.PostCreate, db: Session = Depends(get_db)):
    user = models.get_user_by_id(db, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    post_service_url = "http://localhost:3000/api/posts/"
    post_data = post.dict()
    post_data["user_id"] = user_id  

    response = requests.post(post_service_url, json=post_data)
    
    if response.status_code == 201:
        return response.json()
    
    raise HTTPException(status_code=500, detail="Failed to create post")

# Service status
@app.get("/status")
def status():
    return {"status": "User service is running"}

concurrent_tasks_semaphore = asyncio.Semaphore(2)

@app.get("/process")
async def process_data():
    async with concurrent_tasks_semaphore:
        print("Task started")
        await asyncio.sleep(5)
        print("Task completed")
        return {"message": "Task completed"}