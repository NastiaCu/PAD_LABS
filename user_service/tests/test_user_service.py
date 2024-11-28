import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app
from models import User
from sqlalchemy.orm import Session

client = TestClient(app)

@pytest.fixture
def mock_db_session():
    db = MagicMock()
    yield db

@patch("main.get_db")
@patch("models.get_user_by_email")
@patch("models.create_user")
def test_register_user(mock_create_user, mock_get_user_by_email, mock_get_db, mock_db_session):
    mock_get_db.return_value = mock_db_session
    mock_get_user_by_email.return_value = None
    mock_create_user.return_value = User(id=1, name="Test User", email="newuser@example.com", hashed_password="hashedpassword")

    response = client.post(
        "/api/users/register",
        json={"name": "Test User", "email": "newuser@example.com", "password": "testpassword"},
    )

    assert response.status_code == 200
    assert response.json() == {"id": 1, "name": "Test User", "email": "newuser@example.com"}

@patch("main.get_db")
@patch("models.get_user_by_email")
def test_register_user_already_exists(mock_get_user_by_email, mock_get_db, mock_db_session):
    mock_get_db.return_value = mock_db_session
    mock_get_user_by_email.return_value = User(id=1, name="Existing User", email="testuser@example.com")

    response = client.post(
        "/api/users/register",
        json={"name": "Existing User", "email": "testuser@example.com", "password": "testpassword"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Email already registered"}

@patch("main.get_db")
@patch("auth.authenticate_user")
@patch("auth.create_access_token")
def test_login_valid_credentials(mock_create_access_token, mock_authenticate_user, mock_get_db, mock_db_session):
    mock_get_db.return_value = mock_db_session
    mock_authenticate_user.return_value = User(id=1, name="Test User", email="testuser@example.com")
    mock_create_access_token.return_value = "mocktoken"

    response = client.post(
        "/api/users/login",
        json={"email": "testuser@example.com", "password": "testpassword"},
    )

    assert response.status_code == 200
    assert response.json() == {"token": "mocktoken"}

@patch("main.get_db")
@patch("auth.authenticate_user")
def test_login_invalid_credentials(mock_authenticate_user, mock_get_db, mock_db_session):
    mock_get_db.return_value = mock_db_session
    mock_authenticate_user.return_value = False  

    response = client.post(
        "/api/users/login",
        json={"email": "testuser@example.com", "password": "wrongpassword"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid credentials"}

