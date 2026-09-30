const request = require('supertest');

// Replace the SQLite database with stub functions so the tests never touch blog.db
jest.mock('../../database', () => ({
    get: jest.fn(),
    all: jest.fn(),
    run: jest.fn(),
}));

const db = require('../../database');
const app = require('../../app');

const alice = { username: 'alice', password: 'not-used', sessionId: 'alice-session-id' };
const admin = { username: 'admin', password: 'not-used', sessionId: 'admin-session-id' };

// The session middleware in app.js looks up the user by the sessionId cookie
function loginAs(user) {
    db.get.mockImplementation((sql, params, callback) => {
        callback(null, params[0] === user.sessionId ? user : undefined);
    });
    return `sessionId=${user.sessionId}`;
}

beforeEach(() => {
    jest.resetAllMocks();
    // Start from an empty database that answers every query, so a wrong code path fails an assertion instead of hanging
    db.get.mockImplementation((sql, params, callback) => callback(null, undefined));
    db.all.mockImplementation((sql, callback) => callback(null, []));
    db.run.mockImplementation((sql, params, callback) => callback && callback(null));
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

test("Front page redirects to the login page when there is no session cookie", async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(db.all).not.toHaveBeenCalled();
});

test("Front page lists all posts from the database for a logged-in user", async () => {
    const cookie = loginAs(alice);
    db.all.mockImplementation((sql, callback) => callback(null, [
        { id: 1, title: 'First post', content: 'Hello world' },
        { id: 2, title: 'Second post', content: 'Another post' },
    ]));

    const res = await request(app).get('/').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('First post');
    expect(res.text).toContain('Hello world');
    expect(res.text).toContain('Second post');
    expect(res.text).toContain('Another post');
});

test("Creating a post as a logged-in user saves the title and content and redirects to the front page", async () => {
    const cookie = loginAs(alice);

    const res = await request(app)
        .post('/new-post')
        .set('Cookie', cookie)
        .type('form')
        .send({ title: 'My title', content: 'My content' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(db.run).toHaveBeenCalledWith(
        'INSERT INTO posts (title, content) VALUES (?, ?)',
        ['My title', 'My content'],
        expect.any(Function)
    );
});

test("Creating a post without logging in redirects to the login page and saves nothing", async () => {
    const res = await request(app)
        .post('/new-post')
        .type('form')
        .send({ title: 'Spam', content: 'Should not be saved' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(db.run).not.toHaveBeenCalled();
});

test("Admin page returns 403 Access denied to a logged-in user who is not admin", async () => {
    const cookie = loginAs(alice);

    const res = await request(app).get('/admin').set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.text).toBe('Access denied');
});

test("Admin page is shown to the admin user", async () => {
    const cookie = loginAs(admin);

    const res = await request(app).get('/admin').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin Page');
});
