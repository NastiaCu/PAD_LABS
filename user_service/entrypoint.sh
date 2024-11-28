#!/bin/sh

if [ "$RUN_TESTS" = "1" ]; then
    echo "Running tests..."
    pytest tests/
else
    echo "Starting user service..."
    uvicorn main:app --host 0.0.0.0 --port 8000
fi
