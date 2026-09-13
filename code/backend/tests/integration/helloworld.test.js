// Example integration test w/ Vitest and Supertest
//AI-USAGE SUMMARY
//Tools: ChatGPT
//Overall AI contribution: 80%
//Used for: quickly setting up example test to showcase Supertest usage. Modified it to test the Hello World endpoint of the backend server.

import {describe, it, expect} from 'vitest';
import request from 'supertest';
import app from '../../src/app.js'

// This allows us to test the express app routes without starting the server!
describe('GET /', () => {
    it("Should return 'Hello World from the backend!'", async() => {
        const response = await request(app).get('/');
        expect(response.status).toBe(200);
        expect(response.text).toBe("Hello World from the backend!")
    })


}) 