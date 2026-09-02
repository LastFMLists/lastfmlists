// Every Last.fm request goes through here, so the whole app shares one
// request budget and one backoff.

import {
    HISTORY_FETCH_CONCURRENCY,
    MIN_FETCH_CONCURRENCY,
    RATE_BURST_CAPACITY,
    RATE_REFILL_PER_SECOND
} from '../config.js';

// Set to a future timestamp whenever the API rate-limits us, so all fetchers back off.
let rateLimitBackoffUntil = 0;
let currentFetchConcurrency = HISTORY_FETCH_CONCURRENCY;
let rateTokens = RATE_BURST_CAPACITY;
let rateLastRefillAt = Date.now();

// Pause here if a recent request was rate-limited, so all concurrent workers
// back off together instead of hammering the API.
async function waitOutRateLimitBackoff() {
    const remaining = rateLimitBackoffUntil - Date.now();
    if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
    }
}

// Start a fresh load with the full burst allowance and no backoff pending.
export function resetFetchThrottle() {
    currentFetchConcurrency = HISTORY_FETCH_CONCURRENCY;
    rateLimitBackoffUntil = 0;
}

// How many history pages may be in flight right now (lowered by 429s).
export function getFetchConcurrency() {
    return currentFetchConcurrency;
}

// Global token-bucket limiter (see the RATE_* constants for the reasoning).
// Each request spends one token; while tokens remain, requests start with no
// delay, and once the bucket is empty callers queue up at the refill rate.
// The token bookkeeping is synchronous between awaits, so concurrent callers
// can't double-spend a token. Any active 429 backoff is honoured on top.
function refillRateTokens() {
    const now = Date.now();
    const elapsedSeconds = (now - rateLastRefillAt) / 1000;
    rateTokens = Math.min(RATE_BURST_CAPACITY, rateTokens + elapsedSeconds * RATE_REFILL_PER_SECOND);
    rateLastRefillAt = now;
}

async function acquireRateSlot() {
    while (true) {
        await waitOutRateLimitBackoff();
        refillRateTokens();
        if (rateTokens >= 1) {
            rateTokens -= 1;
            return;
        }
        // Wait for the next token, then loop to re-check (another caller or a
        // fresh 429 backoff may have intervened while we slept).
        const waitMs = ((1 - rateTokens) / RATE_REFILL_PER_SECOND) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
}

// fetch() wrapper that every Last.fm API call goes through, so all of them
// share the one global rate budget.
export async function rateLimitedFetch(url, options) {
    await acquireRateSlot();
    return fetch(url, options);
}

export async function fetchJsonWithRetry(url, maxRetries = 3, delayMs = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await rateLimitedFetch(url);

            // Handle rate limiting explicitly: back every worker off for a bit,
            // empty the token bucket so no burst allowance survives the 429,
            // and shrink the concurrency ceiling so we settle under the limit.
            if (response.status === 429) {
                const retryAfterHeader = parseInt(response.headers.get("retry-after"), 10);
                const backoff = (!isNaN(retryAfterHeader) && retryAfterHeader > 0)
                    ? retryAfterHeader * 1000
                    : delayMs * Math.pow(2, attempt);
                rateLimitBackoffUntil = Date.now() + backoff;
                rateTokens = 0;
                rateLastRefillAt = Date.now();
                currentFetchConcurrency = Math.max(MIN_FETCH_CONCURRENCY, currentFetchConcurrency - 1);
                console.warn(`Rate limited (429). Backing off ${backoff}ms, concurrency now ${currentFetchConcurrency}.`);
                if (attempt === maxRetries) return null;
                await new Promise(resolve => setTimeout(resolve, backoff));
                continue;
            }

            // Check for HTTP errors (500, 503, etc.)
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // CHECK CONTENT TYPE: This is the critical fix
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text(); // Read the HTML to clear the buffer
                console.warn(`Attempt ${attempt + 1}: Expected JSON but got HTML/Text. Full response starts with: ${text.substring(0, 50)}`);
                throw new Error("Invalid Content-Type: Received HTML instead of JSON");
            }

            return await response.json();
            
        } catch (error) {
            if (attempt === maxRetries) {
                console.error(`Final failure after ${maxRetries + 1} attempts: ${url}`, error);
                return null;
            }
            
            // Wait longer for each subsequent retry (Exponential Backoff)
            const waitTime = delayMs * Math.pow(2, attempt); 
            console.log(`Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    return null;
}
