from pydantic import BaseModel
from typing import List, Optional

class CommentBase(BaseModel):
    post_id: int
    comment_text: str
    user_id: int

class CommentCreate(CommentBase):
    content: str
    user_id: int
    post_id: int

class Comment(CommentBase):
    id: int
    content: str
    user_id: int
    post_id: int

    class Config:
        from_attributes = True

class PostBase(BaseModel):
    title: str
    content: str
    car_model: str

class PostCreate(BaseModel):
    title: str
    content: str
    car_model: str
    user_id: int 

class Post(BaseModel):
    id: int
    title: str
    content: str
    car_model: str
    user_id: int
    comments: List[Comment] = []

    class Config:
        from_attributes = True