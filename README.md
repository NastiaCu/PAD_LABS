# Car recommendations and discussions platform

## Application Suitability:

A platform where users can share car recommendations, reviews, and engage in discussions about different models, maintenance, and news is a good choise for microservices usage because the functionality can be separated and work independently. It can also have features for subscribing to car-related topics or participating in group discussions about specific car models or maintenance tips.

### Suitability for microservices:

Car discussions and recommendations are highly user-driven, and traffic might increase unpredictably. Microservices make it easier to scale different components independently. Each core feature (user authentication, recommendation and discussion platform) can function independently. 

### Real-world Examples: 
Similar platforms, like Reddit, use microservices for independent features like user authentication, content recommendation, and message systems. Netflix also uses microservices for scalable content delivery and personalization features.

## Service Boundaries: 

#### User Service: 
* Manages user registration, authentication, and profiles.
* Communicates with Recommendation / Discussion Service via gRPC.
#### Recommendation / Discussion Service: 
* Manages car recommendations, posts, and comments.
* Supports WebSocket for real-time discussions.
* Communicates with the User Service via gRPC for user validation.
#### API Gateway: 
* Central entry point for external clients.
* Routes requests to services based on the API paths.
#### Load Balancers:
* Distribute traffic across multiple instances of each service.
#### gRPC Communication:
* Used for internal communication between the User Service and the Recommendation / Discussion Service.

## Technology Stack and Communication Patterns: 

### Service 1: User Service (Python)

Handles user registration, authentication, and profile management.

>#### Framework: 
>FastAPI (for building APIs with Python.)
>#### Database: 
>PostgreSQL
>#### Authentication: 
>JWT (JSON Web Tokens)
>#### ORM: 
>SQLAlchemy

### Service 2: Recommendations and Discussions Service (JavaScript + Python)

Manages car recommendations and real-time discussions between users.

>#### Framework:
>FastAPI (Python) for handling recommendations (RESTful API).
>
>Node.js + Socket.io (JavaScript) for managing real-time discussions using WebSocket.
>#### Database:
>MongoDB: For storing recommendation data (e.g., car models, user ratings).
>
>Redis: For managing WebSocket sessions in real-time discussions.

### Communication Patterns
>#### RESTful APIs:
>Used for HTTP communication between external clients and services.
>#### gRPC:
>For efficient communication between the User Service and Recommendations/ Discussions Service.
>#### WebSocket (Socket.io):
>For real-time, bi-directional communication in the Discussions Service.

## Data Management Design
### User Service:
#### Endpoints:

1. ```POST /api/users/register``` - Register a new user.

##### Data:
```json
{
  "name": "string",
  "email": "string",
  "password": "string"
}
```
##### Response:
```json
{
  "user_id": "int",
  "message": "User registered successfully."
}
```


2. ```POST /api/users/login``` - Authenticate user and issue JWT.

##### Data:
```json
{
  "email": "string",
  "password": "string"
}
```
##### Response:
```json
{
  "token": "string",
  "user_id": "int"
}
```


3. ```GET /api/users/me``` - Get authenticated user's profile.

##### Response:
```json
{
  "user_id": "int",
  "name": "string",
  "email": "string",
  "profile": {
    "bio": "string",
    "avatar_url": "string"
  }
}
```

4. ```PUT /api/users/me``` - Update the authenticated user's profile.
##### Data:
```json
{
  "name": "string",
  "bio": "string",
  "avatar_url": "string"
}
```
##### Response:
```json
{
  "message": "Profile updated successfully."
}
```

5. ```GET /api/users/{user_id}``` - Get a user's profile by user ID.
##### Response:
```json
{
  "user_id": "int",
  "name": "string",
  "email": "string",
  "profile": {
    "bio": "string",
    "avatar_url": "string"
  }
}
```
### Recommendation/Discussion Service:
#### Endpoints:

1. ```POST /api/posts``` - Create a new car recommendation post.
##### Data:
```json
{
  "user_id": "int",
  "title": "string",
  "content": "string",
  "car_model": "string"
}
```
##### Response:
```json
{
  "post_id": "string",
  "message": "Post created successfully."
}
```

2. ```GET /api/posts``` - Retrieve all car recommendations.
##### Response:
```json
[
  {
    "post_id": "string",
    "user_id": "int",
    "title": "string",
    "content": "string",
    "car_model": "string",
    "timestamp": "string"
  }
]
```

3. ```GET /api/posts/{post_id}``` - Retrieve a specific post by ID.
##### Response:
```json
{
  "post_id": "string",
  "user_id": "int",
  "title": "string",
  "content": "string",
  "car_model": "string",
  "timestamp": "string",
  "comments": [
    {
      "comment_id": "string",
      "user_id": "int",
      "comment_text": "string",
      "timestamp": "string"
    }
  ]
}
```

4. ```PUT /api/posts/{post_id}``` - Update a specific post.
##### Data:
```json
{
  "title": "string",
  "content": "string",
  "car_model": "string"
}
```
##### Response:
```json
{
  "message": "Post updated successfully."
}
```

5. ```DELETE /api/posts/{post_id}``` - Update a specific post.
##### Response:
```json
{
  "message": "Post deleted successfully."
}
```

6. ```WebSocket /ws/posts/{post_id}/comments``` - Real-time updates for comments on a post.
##### Data:
```json
{
  "comment_id": "string",
  "user_id": "int",
  "comment_text": "string",
  "timestamp": "string"
}
```

## Deployment and Scaling
#### Containerization: 
Usage of Docker.
#### Orchestration: 
Kubernetes to manage deployment, scale services based on traffic, and ensure high availability.
#### Scaling Strategy: 
The discussion service can scale horizontally based on the number of active users and chats. Other services can scale independently based on their load.