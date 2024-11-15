CREATE SEQUENCE IF NOT EXISTS users_id_seq;
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR,
    email VARCHAR,
    hashed_password VARCHAR
);
