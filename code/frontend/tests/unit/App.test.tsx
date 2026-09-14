// Example showing how to test REACT with Vitest and the Testing Library + purpose of each import
//AI-USAGE SUMMARY
// Tools: ChatGPT
// All of these tests were generated
// Overall AI contribution: 95%

import { describe, it, expect } from 'vitest' // Fpr defining test suites and test cases + making assertinos
import { render, screen } from '@testing-library/react' // For rendering React components and querying the DOM
import { userEvent } from '@testing-library/user-event' // For simulaing user interactions

import App from '../../src/App'

describe('App', () => {
  it('renders the main content', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Get started' })
    ).toBeInTheDocument()

    expect(
      screen.getByText("src/App.tsx")
    ).toBeInTheDocument()

  })

  it('increments the counter when clicked', async () => {
    const user = userEvent.setup()

    render(<App />)

    const button = screen.getByRole('button', { name: 'Count is 0' })

    expect(button).toBeInTheDocument()

    await user.click(button)

    expect(
      screen.getByRole('button', { name: 'Count is 1' })
    ).toBeInTheDocument()

    await user.click(button)

    expect(
      screen.getByRole('button', { name: 'Count is 2' })
    ).toBeInTheDocument()
  })
})