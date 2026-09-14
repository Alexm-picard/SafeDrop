// No AI contribution - used article and docs as guidance to setup

import "@testing-library/jest-dom/vitest"
import { afterEach, beforeAll, afterAll} from 'vitest'
import { cleanup } from '@testing-library/react'
import { setupServer } from 'msw/node'
import {http, HttpResponse} from 'msw'


// Example of how to set up HTTP mocks using Mock Service Worker!

const restHandlers = [
    http.get('www.google.com', () => {
        return HttpResponse.json({message: "You have visited Google!"})
    })
]

const server = setupServer(...restHandlers);

beforeAll(() => server.listen()) // we can add {onUnhandledRequest: 'error'} here to throw an error for any unhandled requests
afterAll(() => server.close());


afterEach(() => {
  cleanup();
})


