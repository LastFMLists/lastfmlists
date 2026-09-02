// Calendar helpers. Everything here works in the user's local time and in
// whole days, so results do not shift with daylight saving or time of day.

// Whole days since 1970-01-01 in the LOCAL calendar. Reading the calendar
// fields instead of subtracting a fixed offset keeps this correct across DST
// changes, where new Date().getTimezoneOffset() is wrong for historic dates.
export function getLocalDayIndex(timestamp) {
    const date = new Date(timestamp);
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function getLocalDayKeyFromTimestamp(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseTimeToMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) return null;
    const [hoursStr, minutesStr] = timeValue.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
}

export function isWithinTimeRange(timestamp, startTime, endTime) {
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);
    if (startMinutes === null && endMinutes === null) return true;

    const date = new Date(timestamp);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    if (startMinutes !== null && endMinutes !== null) {
        if (startMinutes <= endMinutes) {
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        }
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    if (startMinutes !== null) {
        return currentMinutes >= startMinutes;
    }

    return currentMinutes <= endMinutes;
}

// A strictly increasing week number: whole weeks since the Monday of the epoch
// week. The old "year * 52 + weekOfYear" scheme collided at year boundaries (a
// year can contain 53 weeks), which merged two real weeks into one and
// under-counted consecutive-week streaks. 1970-01-01 was a Thursday, so the
// "+ 3" puts week boundaries on Monday.
export function getWeekIdentifier(date) {
    return Math.floor((getLocalDayIndex(date.getTime()) + 3) / 7);
}

// Check if two periods are consecutive
export function isNextPeriod(prev, curr, periodType) {
    if (periodType === 'day') {
        return curr === prev + 1; // Next day in numerical sequence
    } else if (periodType === 'week' || periodType === 'month') {
        return curr === prev + 1; // Next week/month in numerical sequence
    }
    return false;
}

/**
 * Format the duration from milliseconds into a readable string: "x days y hours z minutes".
 * @param {number} durationInMillis - Duration in milliseconds.
 * @returns {string} - Formatted duration string.
 */
export function formatDuration(durationInMillis) {
    const days = Math.floor(durationInMillis / (1000 * 60 * 60 * 24));
    const hours = Math.floor((durationInMillis % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((durationInMillis % (1000 * 60 * 60)) / (1000 * 60));

    let result = '';
    if (days > 0) result += `${days} day${days > 1 ? 's' : ''} `;
    if (hours > 0) result += `${hours} hour${hours > 1 ? 's' : ''} `;
    if (minutes > 0) result += `${minutes} minute${minutes > 1 ? 's' : ''}`;

    return result.trim();
}

export function getPeriodInfo(date, period) {
    if (period === 'day') {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return {
            key: `${y}-${m}-${d}`,
            label: `${y}-${m}-${d}`
        };
    }

    if (period === 'week') {
        const year = date.getFullYear();
        const week = getWeekNumber(date);
        return {
            key: `${year}-W${week}`,
            label: `${year}-W${week}`
        };
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return {
        key: `${y}-${m}`,
        label: `${y}-${m}`
    };
}

// Week of the year (1-53). Counted in whole local days: the previous version
// divided a millisecond difference, so the same calendar day could land in two
// different weeks depending on the time of day.
export function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = getLocalDayIndex(date.getTime()) - getLocalDayIndex(firstDayOfYear.getTime());
    return Math.floor((pastDaysOfYear + firstDayOfYear.getDay()) / 7) + 1;
}

export function getFirstScrobbleYear(timestampValue) {
    if (timestampValue === undefined || timestampValue === null || timestampValue === "") return null;
    const timestamp = parseInt(timestampValue, 10);
    if (isNaN(timestamp)) return null;
    return new Date(timestamp).getFullYear();
}

export function getDaysSinceTimestamp(timestampValue) {
    if (timestampValue === undefined || timestampValue === null || timestampValue === "") return null;
    const timestamp = parseInt(timestampValue, 10);
    if (isNaN(timestamp)) return null;
    return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

export function formatDateInputValue(dateValue) {
    const date = new Date(dateValue);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
