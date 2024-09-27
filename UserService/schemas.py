from pydantic import BaseModel

class UserBase(BaseModel):
    name: str
    email: str

class User(BaseModel):
    id: int
    name: str
    email: str

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(UserBase):
    id: int

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    name: str
    bio: str
    avatar_url: str

class PostCreate(BaseModel):
    title: str
    content: str
    car_model: str

    class Config:
        from_attributes = True