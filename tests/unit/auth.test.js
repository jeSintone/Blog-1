const request = require('supertest');
const bcrypt = require('bcrypt');

// Replace the SQLite database with stub functions so the tests never touch blog.db
jest.mock('../../database', () => ({
    get: jest.fn(),
    all: jest.fn(),
    run: jest.fn(),
}));

const db = require('../../database');
const app = require('../../app');

// Makes "SELECT * FROM users WHERE username = ?" return `user`, but only when asked for that username
function userInDatabase(user) {
    db.get.mockImplementation((sql, params, callback) => {
        callback(null, params[0] === user.username ? user : undefined);
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    // Start from an empty database that answers every query, so a wrong code path fails an assertion instead of hanging
    db.get.mockImplementation((sql, params, callback) => callback(null, undefined));
    db.all.mockImplementation((sql, callback) => callback(null, []));
    db.run.mockImplementation((sql, params, callback) => callback && callback(null));
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

test("Login with the correct password sets an httpOnly session cookie and redirects to the front page", async () => {
    userInDatabase({ username: 'alice', password: bcrypt.hashSync('secret123', 4), sessionId: '0' });

    const res = await request(app)
        .post('/auth/login')
        .type('form')
        .send({ username: 'alice', password: 'secret123' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^sessionId=[^;]+;/);
    expect(cookie).toContain('HttpOnly');
    // The cookie value must be stored for alice, otherwise the next request cannot find her session
    const sessionId = cookie.match(/^sessionId=([^;]+);/)[1];
    expect(db.run).toHaveBeenCalledWith(
        'UPDATE users SET sessionId = ? WHERE username = ?',
        [sessionId, 'alice'],
        expect.any(Function)
    );
});

test("Login with a wrong password shows an error and does not set a session cookie", async () => {
    userInDatabase({ username: 'alice', password: bcrypt.hashSync('secret123', 4), sessionId: '0' });

    const res = await request(app)
        .post('/auth/login')
        .type('form')
        .send({ username: 'alice', password: 'wrong-password' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid username or password');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(db.run).not.toHaveBeenCalled();
});

test("Registering a new user stores a bcrypt hash instead of the plain-text password", async () => {
    const res = await request(app)
        .post('/auth/register')
        .type('form')
        .send({ username: 'bob', password: 'hunter2' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO users');
    expect(params[0]).toBe('bob');
    expect(params[1]).not.toBe('hunter2');
    expect(bcrypt.compareSync('hunter2', params[1])).toBe(true);
});

test("Registering with a username that is already taken does not create a second account", async () => {
    userInDatabase({ username: 'bob', password: 'existing-hash', sessionId: '0' });

    const res = await request(app)
        .post('/auth/register')
        .type('form')
        .send({ username: 'bob', password: 'another-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(db.run).not.toHaveBeenCalled();
});
