// Security regression tests.
// Each test states a security property of the app and fails if that property is broken.
// They were added after a defect-testing exercise showed the original 10 tests missed
// (or only accidentally caught) several serious vulnerabilities. Every test here passes
// on the current clean code and fails when its matching defect is introduced.

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

// Answer the user lookup (by username) and the session lookup (by sessionId) for one user.
// Tolerant of a 2-argument db.get(sql, callback), so a query built by string concatenation
// is still recorded and inspectable instead of throwing.
function userInDatabase(user) {
    db.get.mockImplementation((sql, params, callback) => {
        const cb = typeof params === 'function' ? params : callback;
        const asked = Array.isArray(params) ? params[0] : undefined;
        cb(null, asked === user.username || asked === user.sessionId ? user : undefined);
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    // Default: an empty database that still answers, whatever argument shape it is called with
    db.get.mockImplementation((sql, params, callback) => {
        const cb = typeof params === 'function' ? params : callback;
        if (cb) cb(null, undefined);
    });
    db.all.mockImplementation((sql, callback) => callback(null, []));
    db.run.mockImplementation((sql, params, callback) => callback && callback(null));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

// Defect 1 - hard-coded backdoor password (CWE-798)
test("Login rejects a password that is not the user's own, so there is no backdoor password", async () => {
    userInDatabase({ username: 'alice', password: bcrypt.hashSync('secret123', 4), sessionId: '0' });

    const res = await request(app)
        .post('/auth/login')
        .type('form')
        .send({ username: 'alice', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid username or password');
    expect(res.headers['set-cookie']).toBeUndefined();
});

// Defect 2 - SQL injection via string-built query (CWE-89)
test("Session lookup binds the cookie as a parameter and never builds SQL from it", async () => {
    const malicious = "x' OR '1'='1";

    await request(app).get('/').set('Cookie', `sessionId=${malicious}`);

    const calls = db.get.mock.calls;
    // No query text may contain the raw cookie value: user input travels as a bound parameter
    for (const [sql] of calls) {
        expect(typeof sql).toBe('string');
        expect(sql).not.toContain(malicious);
    }
    // The session lookup must still have happened, as a parameterized query
    const parameterized = calls.find(([sql]) => /WHERE\s+sessionId\s*=\s*\?/i.test(sql));
    expect(parameterized).toBeDefined();
    expect(parameterized[1]).toContain(malicious);
});

// Defect 4 - admin check that trusts a client-supplied cookie (CWE-565, broken access control)
test("A non-admin user cannot reach /admin by sending a forged role cookie", async () => {
    userInDatabase({ username: 'alice', password: 'not-used', sessionId: 'alice-session-id' });

    const res = await request(app)
        .get('/admin')
        .set('Cookie', ['sessionId=alice-session-id', 'role=admin']);

    expect(res.status).toBe(403);
    expect(res.text).toBe('Access denied');
});
