CREATE SEQUENCE IF NOT EXISTS posts_id_seq;
CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR,
    content TEXT,
    car_model VARCHAR,
    user_id INTEGER
);
