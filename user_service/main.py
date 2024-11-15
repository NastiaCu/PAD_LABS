from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
import models, schemas
from database import SessionLocal, engine
import auth
import requests 
import asyncio
import consul
import os
import grpc
import time
from concurrent import futures
import user_pb2
import user_pb2_grpc
import threading
import uuid
from prometheus_fastapi_instrumentator import Instrumentator

REQUEST_LIMIT = 10
request_count = 0
request_window = 1

INSTANCE_ID = os.environ.get('INSTANCE_ID', '1')
models.Base.metadata.create_all(bind=engine)
app = FastAPI()

instrumentator = Instrumentator()
instrumentator.instrument(app).expose(app)

def register_with_consul():
    c = consul.Consul(host='consul', port=8500)
    instance_uuid = f"user-service-{uuid.uuid4()}"
    c.agent.service.register(
        name='user-service',
        service_id=instance_uuid,
        address='user_service',
        port=8000,
        tags=["users"],
    )
    print(f"Registered user-service with Consul as {instance_uuid}")

@app.on_event("startup")
async def startup_event():
    register_with_consul()

def monitor_requests():
    global request_count
    while True:
        time.sleep(request_window)
        if request_count > REQUEST_LIMIT:
            print(f"ALERT: High request load detected! ({request_count} requests per second)")
        request_count = 0

monitor_thread = threading.Thread(target=monitor_requests)
monitor_thread.daemon = True
monitor_thread.start()

def increase_request_count():
    global request_count
    request_count += 1

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/api/users/register", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    increase_request_count()
    user_in_db = models.get_user_by_email(db, user.email)
    if user_in_db:
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = models.create_user(db=db, user=user)
    return new_user

@app.post("/api/users/login")
def login(user: schemas.UserLogin, db: Session = Depends(get_db)):
    increase_request_count()
    user_in_db = auth.authenticate_user(db, user.email, user.password)
    if not user_in_db:
        raise HTTPException(status_code=400, detail="Invalid credentials")
    token = auth.create_access_token(data={"sub": user.email})
    return {"token": token}

@app.get("/api/users/me", response_model=schemas.UserResponse)
def get_profile(current_user: schemas.User = Depends(auth.get_current_user)):
    increase_request_count()
    return current_user

@app.put("/api/users/me", response_model=dict)
def update_profile(updated_user: schemas.UserUpdate, current_user: schemas.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    increase_request_count()
    updated_user_data = models.update_user_profile(db, user_id=current_user.id, updated_user=updated_user)
    if not updated_user_data:
        raise HTTPException(status_code=400, detail="Failed to update profile")
    return {"message": "Profile updated successfully"}

@app.get("/api/users/{user_id}", response_model=schemas.UserResponse)
def get_user_by_id(user_id: int, db: Session = Depends(get_db)):
    increase_request_count()
    user = models.get_user_by_id(db, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/status")
def status():
    return {"status": f"User service instance {INSTANCE_ID} is running"}

class UserServiceServicer(user_pb2_grpc.UserServiceServicer):
    def GetUserStatus(self, request, context):
        user_id = request.user_id
        if user_id == '1':
            return user_pb2.UserResponse(status='active')
        else:
            return user_pb2.UserResponse(status='inactive')

def serve_grpc():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    user_pb2_grpc.add_UserServiceServicer_to_server(UserServiceServicer(), server)
    server.add_insecure_port('[::]:50051')
    server.start()
    print("gRPC server for User Service is running on port 50051")
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(0)

grpc_thread = threading.Thread(target=serve_grpc)
grpc_thread.daemon = True
grpc_thread.start()
