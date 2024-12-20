# Car recommendations and discussions platform

## Runnind and Deploying the project
In order to run the project, it is necessary to have installed and running Docker application.

After that it is necessary to run the following commands:
```
docker-compose build
docker-compose up
```
**Troubleshooting:**

Below are presented the commands which can help if any port is occupied:

``` sudo lsof -i -P -n | grep <PORT> ```

``` sudo kill -9 <PID> ```

To run the test use the following command:

```docker-compose run -e RUN_TESTS=1 user_service```

## Application Suitability:

A platform where users can share car recommendations, reviews, and engage in discussions about different models, maintenance, and news is a good choise for microservices usage because the functionality can be separated and work independently. It can also have features for subscribing to car-related topics or participating in group discussions about specific car models or maintenance tips.

### Suitability for microservices:

Car discussions and recommendations are highly user-driven, and traffic might increase unpredictably. Microservices make it easier to scale different components independently. Each core feature (user authentication, recommendation and discussion platform) can function independently. 

### Real-world Examples: 
Similar platforms, like Reddit, use microservices for independent features like user authentication, content recommendation, and message systems. Netflix also uses microservices for scalable content delivery and personalization features.

## Service Boundaries: 

#### User Service: 
* Manages user registration, authentication, and profiles.

#### Recommendation / Discussion Service: 
* Manages car recommendations, posts, and comments.
* Supports WebSocket for real-time discussions.
#### API Gateway: 
* Central entry point for external clients.
* Routes requests to services based on the API paths.
#### Load Balancers:
* Distribute traffic across multiple instances of each service.
#### gRPC Communication:
* Used for internal communication between services and Service discovery.

### System Architecture Diagram:
![alt text](scheme.png)

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

### Service 2: Recommendations and Discussions Service (Python)

Manages car recommendations and real-time discussions between users.

>#### Framework:
>FastAPI (Python) for handling recommendations (RESTful API).
>
>FastAPI WebSocket (Python) for managing real-time discussions using WebSocket.
>#### Database:
>PostgreSQL
>
>Redis: For managing WebSocket sessions in real-time discussions.

### API Gateway
>Framework: Express.js (Node.js)

### Communication Patterns
>#### RESTful APIs:
>Used for HTTP communication between external clients and services.
>#### gRPC:
>For efficient communication between services and service discovery.
>#### WebSocket:
>For real-time, bi-directional communication in the Discussions Service.

## Data Management Design
### User Service:
#### Endpoints:

1. ```POST /api/users/register``` - Register a new user.
   
This is the first endpoint that should be requested, as if not, the login request won't work.

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
    "name": "string",
    "email": "string",
    "id": "int"
}
```

2. ```POST /api/users/login``` - Authenticate user and issue JWT. 
  
This is the second endpoint needed, as it generates the JWT token, which is necessary for testing other endpoints.

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
  "token": "string"
}
```

3. ```GET /api/users/me``` - Get authenticated user's profile. Requires JWT token.

##### Response:
```json
{
  "name": "string",
  "email": "string",
  "id": "int"
}
```

4. ```PUT /api/users/me``` - Update the authenticated user's profile. Requires JWT token.
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
  "name": "string",
  "email": "string",
  "id": "int"
}
```
### Recommendation/Discussion Service:
#### Endpoints:

1. ```POST /api/posts``` - Create a new car recommendation post. 

This endpoint is the first one in the testing process. After that all other endpoints can be tested.
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
    "id": "int",
    "title": "string",
    "content": "string",
    "car_model": "string",
    "user_id": "int",
    "comments": []
}
```

1. ```GET /api/posts``` - Retrieve all car recommendations.
##### Response:
```json
[
  {
    "id": "int",
    "car_model": "string",
    "user_id": "int",
    "content": "string",
    "title": "string"
  }
]
```

1. ```GET /api/posts/{post_id}``` - Retrieve a specific post by ID.
##### Response:
```json
{
    "id": "int",
    "title": "string",
    "content": "string",
    "car_model": "string",
    "user_id": "int",
    "comments": []
}
```

1. ```PUT /api/posts/{post_id}``` - Update a specific post by ID.
##### Data:
```json
{
  "title": "string",
  "content": "string",
  "car_model": "string",
  "user_id": "int"
}
```
##### Response:
```json
{
  "message": "Post updated successfully."
}
```

1. ```DELETE /api/posts/{post_id}``` - Delete a specific post by ID.
##### Response:
```json
{
  "message": "Post deleted successfully."
}
```

1. ```WebSocket ws://localhost:3000/ws/api/comments``` - Real-time updates for comments on a post.
##### Data:
```json
{
  "content": "string",
  "user_id": "int"
}
```

## Deployment and Scaling
#### Containerization: 
Usage of Docker.
#### Orchestration: 
Docker Compose to manage deployment, scale services based on traffic, and ensure high availability.

### Updated System Architecture Diagram:
![alt text](UpdatedScheme.png)

The above diagram represents the updated project with addition of new components, which help to improve the project.
The new components are the following:
1. **Transaction Coordinator or Saga Coordinator:**
   
   These are needed to orchestrate 2PC transactions (for transaction coordinator) and to handle long running transactions (for saga coordinator)

2. **Database replication:** 
   
   For the User service are added DB replicas, where we have one Master DB and two Slave DBs.

3. **ELK Stack:**
   
   It is needed for logging and monitoring. It implies three components:
   1. **Logstash** - Responsible for aggregating and processing log data from all services (API Gateway, User Service, Post Service, Redis, etc.). It acts as the pipeline for collecting logs.
   2. **Elasticsearch** - Serves as the indexing and storage engine for logs. All logs processed by Logstash are stored in Elasticsearch, allowing fast searches and complex queries on the data.
   3. **Kibana** - Provides visualization and analysis tools for the logs stored in Elasticsearch. Kibana is used to create dashboards and alerts for monitoring key metrics.

4. **Consistent Hashing for Redis cache:**
   
   Redis is set up with consistent hashing to distribute cache data evenly across nodes, which ensures balanced load distribution and minimizes data movement when scaling. It is configured as an HA Cluster. This ensures that even if one node fails, others can continue to serve cached data, supporting system resilience.

5. **Data Warehouse:**
   
   A staging area aggregates data from the User DB and Post DB replicas. The Data Warehouse serves as a consolidated data repository for historical data and analysis.