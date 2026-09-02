// The equation language: field resolvers, tokenizer, expression parser and
// the filter/sort/unique/show pipeline built on top of them.

import { state } from '../state.js';
import { getDaysSinceTimestamp, getFirstScrobbleYear } from '../time.js';
import { getTrackAverageListeningMap } from './metrics.js';

export const equationFieldResolvers = {
    "artist-name": (item) => item.Artist,
    "album-name": (item) => item.Album,
    "track-name": (item) => item.Track,
    "artist-name-length": (item) => item.Artist?.length ?? null,
    "album-name-length": (item) => item.Album?.length ?? null,
    "track-name-length": (item) => item.Track?.length ?? null,
    "artist-word-count": (item) => item.Artist?.trim().split(/\s+/).length ?? null,
    "album-word-count": (item) => item.Album?.trim().split(/\s+/).length ?? null,
    "track-word-count": (item) => item.Track?.trim().split(/\s+/).length ?? null,
    "artist-scrobble-count": (item) => state.artistDataMap[item.Artist.toLowerCase()]?.user_scrobbles ?? null,
    "album-scrobble-count": (item) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles ?? null,
    "track-scrobble-count": (item) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.user_scrobbles ?? null,
    "artist-rank": (item) => state.artistDataMap[item.Artist.toLowerCase()]?.rank ?? null,
    "album-rank": (item) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank ?? null,
    "track-rank": (item) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.rank ?? null,
    "artist-track-count": (item) => state.artistDataMap[item.Artist.toLowerCase()]?.track_count ?? null,
    "album-track-count": (item) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.track_count ?? null,
    "artist-first-scrobble-year": (item) => getFirstScrobbleYear(state.artistDataMap[item.Artist.toLowerCase()]?.firstscrobble),
    "album-first-scrobble-year": (item) => getFirstScrobbleYear(state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble),
    "track-first-scrobble-year": (item) => getFirstScrobbleYear(state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.firstscrobble),
    "artist-days-since-last": (item) => getDaysSinceTimestamp(state.artistDataMap[item.Artist.toLowerCase()]?.lastscrobble),
    "album-days-since-last": (item) => getDaysSinceTimestamp(state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.lastscrobble),
    "track-days-since-last": (item) => getDaysSinceTimestamp(state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.lastscrobble),
    "artist-listeners": (item) => state.artistDataMap[item.Artist.toLowerCase()]?.listeners ?? null,
    "album-listeners": (item) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners ?? null,
    "track-listeners": (item) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.listeners ?? null,
    "artist-global-scrobbles": (item) => state.artistDataMap[item.Artist.toLowerCase()]?.playcount ?? null,
    "album-global-scrobbles": (item) => state.albumDataMap[`${item.Album.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount ?? null,
    "track-global-scrobbles": (item) => state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.playcount ?? null,
    "track-duration": (item) => {
        const durationMs = state.trackDataMap[`${item.Track.toLowerCase()}||${item.Artist.toLowerCase()}`]?.duration;
        return durationMs === undefined || durationMs === null ? null : durationMs / 1000;
    },
    "scrobble-order": (item) => item.order ?? null,
    "year": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getFullYear() : null,
    "month": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getMonth() + 1 : null,
    "day-of-month": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getDate() : null,
    "weekday": (item) => item.Date ? new Date(parseInt(item.Date, 10)).getDay() : null,
    "oldest-average-listening-time": (item, equationContext = {}) => {
        const minScrobbles = Math.max(1, parseInt(equationContext.xValue, 10) || 1);
        const mapping = getTrackAverageListeningMap(minScrobbles);
        const key = `${item.Track?.toLowerCase() || ""}||${item.Artist?.toLowerCase() || ""}`;
        return mapping[key] ?? null;
    },
    "newest-average-listening-time": (item, equationContext = {}) => {
        const minScrobbles = Math.max(1, parseInt(equationContext.xValue, 10) || 1);
        const mapping = getTrackAverageListeningMap(minScrobbles);
        const key = `${item.Track?.toLowerCase() || ""}||${item.Artist?.toLowerCase() || ""}`;
        const averageTimestamp = mapping[key];
        if (averageTimestamp === undefined || averageTimestamp === null) return null;
        return -averageTimestamp;
    }
};

const equationFieldNames = Object.keys(equationFieldResolvers).sort((a, b) => b.length - a.length);
const equationNumericFieldNames = [
    "artist-name-length",
    "album-name-length",
    "track-name-length",
    "artist-word-count",
    "album-word-count",
    "track-word-count",
    "artist-scrobble-count",
    "album-scrobble-count",
    "track-scrobble-count",
    "artist-rank",
    "album-rank",
    "track-rank",
    "artist-track-count",
    "album-track-count",
    "artist-first-scrobble-year",
    "album-first-scrobble-year",
    "track-first-scrobble-year",
    "artist-days-since-last",
    "album-days-since-last",
    "track-days-since-last",
    "artist-listeners",
    "album-listeners",
    "track-listeners",
    "artist-global-scrobbles",
    "album-global-scrobbles",
    "track-global-scrobbles",
    "track-duration",
    "scrobble-order",
    "year",
    "month",
    "day-of-month",
    "weekday",
    "oldest-average-listening-time",
    "newest-average-listening-time"
];
export const equationOperatorTokens = [" = ", " != ", " < ", " <= ", " > ", " >= ", " + ", " - ", " * ", " / ", " % ", "(", ")", "; "];
export const equationCommands = [
    {
        label: "sort",
        description: "Sort by a field. Numbers sort numerically, text sorts alphabetically. Syntax: sort <field> [asc|desc]."
    },
    {
        label: "unique",
        description: "Keep at most N items per value. Syntax: unique <field> [max-per-value]."
    },
    {
        label: "filter",
        description: "Filter items with an equation/comparison. Prefix is optional."
    },
    {
        label: "show",
        description: "Show a field in each entry detail. Syntax: show <field>."
    }
];
export const equationOperatorDescriptions = {
    "=": "Equals",
    "!=": "Not equal",
    "<": "Less than",
    "<=": "Less than or equal",
    ">": "Greater than",
    ">=": "Greater than or equal",
    "+": "Add",
    "-": "Subtract",
    "*": "Multiply",
    "/": "Divide",
    "%": "Remainder (modulus)",
    "(": "Open parenthesis",
    ")": "Close parenthesis",
    ";": "End command"
};

export function formatEquationFieldLabel(fieldName) {
    return fieldName
        .split("-")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export function getEquationFieldValue(item, fieldName, equationContext = {}) {
    const resolver = equationFieldResolvers[fieldName];
    if (!resolver) return null;
    const value = resolver(item, equationContext);
    return value === undefined ? null : value;
}

function tokenizeEquationExpression(expression) {
    const tokens = [];
    const source = expression.trim();
    const lowerSource = source.toLowerCase();
    let index = 0;

    while (index < source.length) {
        const current = source[index];

        if (/\s/.test(current)) {
            index += 1;
            continue;
        }

        if (/\d/.test(current)) {
            let numberEnd = index + 1;
            while (numberEnd < source.length && /\d/.test(source[numberEnd])) {
                numberEnd += 1;
            }
            tokens.push({ type: "number", value: Number(source.slice(index, numberEnd)) });
            index = numberEnd;
            continue;
        }

        if (["+", "-", "*", "/", "%", "(", ")"].includes(current)) {
            tokens.push({ type: "symbol", value: current });
            index += 1;
            continue;
        }

        let matchedField = null;
        for (const fieldName of equationFieldNames) {
            if (lowerSource.startsWith(fieldName, index)) {
                matchedField = fieldName;
                break;
            }
        }

        if (!matchedField) {
            return null;
        }

        tokens.push({ type: "field", value: matchedField });
        index += matchedField.length;
    }

    return tokens;
}

function parseEquationExpression(tokens, item, equationContext = {}) {
    let tokenIndex = 0;

    const parseFactor = () => {
        const token = tokens[tokenIndex];
        if (!token) return null;

        if (token.type === "symbol" && token.value === "-") {
            tokenIndex += 1;
            const operand = parseFactor();
            if (typeof operand !== "number" || !Number.isFinite(operand)) return null;
            return -operand;
        }

        if (token.type === "number") {
            tokenIndex += 1;
            return token.value;
        }

        if (token.type === "field") {
            tokenIndex += 1;
            return getEquationFieldValue(item, token.value, equationContext);
        }

        if (token.type === "symbol" && token.value === "(") {
            tokenIndex += 1;
            const innerValue = parseAddSubtract();
            const closing = tokens[tokenIndex];
            if (!closing || closing.type !== "symbol" || closing.value !== ")") return null;
            tokenIndex += 1;
            return innerValue;
        }

        return null;
    };

    const parseMultiplyDivide = () => {
        let left = parseFactor();
        if (left === null || left === undefined) return null;

        while (true) {
            const operator = tokens[tokenIndex];
            if (!operator || operator.type !== "symbol" || (operator.value !== "*" && operator.value !== "/" && operator.value !== "%")) {
                break;
            }

            tokenIndex += 1;
            const right = parseFactor();
            if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
                return null;
            }

            if (operator.value === "*") {
                left *= right;
            } else if (operator.value === "/") {
                if (right === 0) return null;
                left /= right;
            } else {
                if (right === 0) return null;
                left %= right;
            }
        }

        return left;
    };

    const parseAddSubtract = () => {
        let left = parseMultiplyDivide();
        if (left === null || left === undefined) return null;

        while (true) {
            const operator = tokens[tokenIndex];
            if (!operator || operator.type !== "symbol" || (operator.value !== "+" && operator.value !== "-")) {
                break;
            }

            tokenIndex += 1;
            const right = parseMultiplyDivide();
            if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
                return null;
            }

            if (operator.value === "+") {
                left += right;
            } else {
                left -= right;
            }
        }

        return left;
    };

    const result = parseAddSubtract();
    if (tokenIndex !== tokens.length) return null;
    return result;
}

function evaluateEquationSide(sideExpression, item, equationContext = {}) {
    const expression = sideExpression.trim();
    if (!expression) return null;

    const doubleQuoted = expression.match(/^"([\s\S]*)"$/);
    if (doubleQuoted) return doubleQuoted[1];

    const singleQuoted = expression.match(/^'([\s\S]*)'$/);
    if (singleQuoted) return singleQuoted[1];

    const tokens = tokenizeEquationExpression(expression);
    if (!tokens || tokens.length === 0) return null;

    return parseEquationExpression(tokens, item, equationContext);
}

function findTopLevelComparisonOperator(expression) {
    let depth = 0;
    let quote = null;

    for (let index = 0; index < expression.length; index++) {
        const current = expression[index];
        const next = expression[index + 1];

        if (quote) {
            if (current === quote) quote = null;
            continue;
        }

        if (current === '"' || current === "'") {
            quote = current;
            continue;
        }

        if (current === "(") {
            depth += 1;
            continue;
        }

        if (current === ")") {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (depth > 0) continue;

        const pair = `${current}${next || ""}`;
        if (["<=", ">=", "!=", "=="].includes(pair)) {
            return { index, operator: pair === "==" ? "=" : pair, length: 2 };
        }

        if (["=", "<", ">"].includes(current)) {
            return { index, operator: current, length: 1 };
        }
    }

    return null;
}

function compareEquationValues(left, right, operator) {
    const leftIsNumber = typeof left === "number" && Number.isFinite(left);
    const rightIsNumber = typeof right === "number" && Number.isFinite(right);
    const leftIsString = typeof left === "string";
    const rightIsString = typeof right === "string";

    if (operator === "=" || operator === "!=") {
        if (leftIsNumber && rightIsNumber) {
            return operator === "=" ? left === right : left !== right;
        }

        if (leftIsString && rightIsString) {
            const normalizedLeft = left.trim().toLowerCase();
            const normalizedRight = right.trim().toLowerCase();
            return operator === "="
                ? normalizedLeft === normalizedRight
                : normalizedLeft !== normalizedRight;
        }

        return false;
    }

    if (!leftIsNumber || !rightIsNumber) return false;

    if (operator === "<") return left < right;
    if (operator === ">") return left > right;
    if (operator === "<=") return left <= right;
    if (operator === ">=") return left >= right;
    return false;
}

function compileEquationClause(clause) {
    const comparison = findTopLevelComparisonOperator(clause);
    if (!comparison) return null;

    const leftExpression = clause.slice(0, comparison.index).trim();
    const rightExpression = clause.slice(comparison.index + comparison.length).trim();

    if (!leftExpression || !rightExpression) return null;

    return (item, equationContext = {}) => {
        const leftValue = evaluateEquationSide(leftExpression, item, equationContext);
        const rightValue = evaluateEquationSide(rightExpression, item, equationContext);
        if (leftValue === null || leftValue === undefined || rightValue === null || rightValue === undefined) {
            return false;
        }
        return compareEquationValues(leftValue, rightValue, comparison.operator);
    };
}

function createEquationUniqueKey(value) {
    if (value === null || value === undefined) return "__null__";
    if (typeof value === "string") return `string:${value.trim().toLowerCase()}`;
    return `value:${String(value)}`;
}

function parseEquationPipeline(equationsInput) {
    const clauses = equationsInput
        .split(/[;\n]+/)
        .map(clause => clause.trim())
        .filter(Boolean);

    const steps = [];

    for (const clause of clauses) {
        const sortMatch = clause.match(/^sort\s+([a-z0-9-]+)(?:\s+(asc|desc))?$/i);
        if (sortMatch) {
            const fieldName = sortMatch[1].toLowerCase();
            const direction = (sortMatch[2] || "asc").toLowerCase();

            if (!equationFieldResolvers[fieldName]) {
                return { error: `Invalid sort field: ${fieldName}`, steps: [] };
            }

            steps.push({ type: "sort", field: fieldName, direction: direction === "desc" ? "desc" : "asc" });
            continue;
        }

        const uniqueMatch = clause.match(/^unique\s+([a-z0-9-]+)(?:\s+(\d+))?$/i);
        if (uniqueMatch) {
            const fieldName = uniqueMatch[1].toLowerCase();
            const maxPerUnique = parseInt(uniqueMatch[2] || "1", 10);

            if (!equationFieldResolvers[fieldName]) {
                return { error: `Invalid unique field: ${fieldName}`, steps: [] };
            }

            steps.push({
                type: "unique",
                field: fieldName,
                maxPerUnique: isNaN(maxPerUnique) || maxPerUnique < 1 ? 1 : maxPerUnique
            });
            continue;
        }

        const showMatch = clause.match(/^show\s+([a-z0-9-]+)$/i);
        if (showMatch) {
            const fieldName = showMatch[1].toLowerCase();

            if (!equationFieldResolvers[fieldName]) {
                return { error: `Invalid show field: ${fieldName}`, steps: [] };
            }

            steps.push({ type: "show", field: fieldName });
            continue;
        }

        const filterMatch = clause.match(/^filter\s+(.+)$/i);
        const expression = (filterMatch ? filterMatch[1] : clause).trim();
        const predicate = compileEquationClause(expression);
        if (!predicate) {
            return { error: `Invalid filter equation: ${expression}`, steps: [] };
        }

        steps.push({ type: "filter", expression, predicate });
    }

    return { error: null, steps };
}

export function applyEquationPipeline(tracks, equationsInput, equationContext = {}) {
    const trimmedInput = (equationsInput || "").trim();
    if (!trimmedInput) {
        return { usedPipeline: false, hasOrderingStep: false, tracks };
    }

    const { error, steps } = parseEquationPipeline(trimmedInput);
    if (error) {
        console.warn(error);
        return { usedPipeline: true, hasOrderingStep: false, tracks: [] };
    }

    const workingTracks = tracks.map(track => ({ ...track, equationPipelineSortHistory: [], equationPipelineShowFields: [] }));
    let hasOrderingStep = false;
    let currentTracks = workingTracks;
    const textSortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    for (const step of steps) {
        if (step.type === "filter") {
            currentTracks = currentTracks.filter(track => step.predicate(track, equationContext));
            continue;
        }

        if (step.type === "sort") {
            hasOrderingStep = true;

            currentTracks = currentTracks
                .map(track => {
                    const sortValue = getEquationFieldValue(track, step.field, equationContext);
                    if (sortValue === null || sortValue === undefined) return null;

                    const isSortableNumber = typeof sortValue === "number" && Number.isFinite(sortValue);
                    const isSortableString = typeof sortValue === "string";
                    if (!isSortableNumber && !isSortableString) return null;

                    const sortType = isSortableNumber ? "number" : "string";
                    const sortKey = isSortableNumber
                        ? sortValue
                        : sortValue.toLocaleLowerCase();

                    return {
                        ...track,
                        equationPipelineSortHistory: [
                            ...(track.equationPipelineSortHistory || []),
                            {
                                field: step.field,
                                direction: step.direction,
                                value: sortValue,
                                sortType,
                                sortKey
                            }
                        ]
                    };
                })
                .filter(Boolean);

            currentTracks.sort((a, b) => {
                const aHistory = a.equationPipelineSortHistory || [];
                const bHistory = b.equationPipelineSortHistory || [];
                const aLast = aHistory[aHistory.length - 1];
                const bLast = bHistory[bHistory.length - 1];
                const aSortType = aLast?.sortType;
                const bSortType = bLast?.sortType;
                const aSortKey = aLast?.sortKey;
                const bSortKey = bLast?.sortKey;

                if (aSortType === "number" && bSortType === "number") {
                    return step.direction === "asc"
                        ? aSortKey - bSortKey
                        : bSortKey - aSortKey;
                }

                const leftText = (aSortKey ?? "").toString();
                const rightText = (bSortKey ?? "").toString();
                const textComparison = textSortCollator.compare(leftText, rightText);

                return step.direction === "asc" ? textComparison : -textComparison;
            });

            continue;
        }

        if (step.type === "unique") {
            hasOrderingStep = true;
            const perUniqueCounts = {};
            const uniqueTracks = [];

            for (const track of currentTracks) {
                const uniqueValue = getEquationFieldValue(track, step.field, equationContext);
                const uniqueKey = createEquationUniqueKey(uniqueValue);
                const countForKey = perUniqueCounts[uniqueKey] || 0;
                if (countForKey >= step.maxPerUnique) {
                    continue;
                }

                perUniqueCounts[uniqueKey] = countForKey + 1;
                uniqueTracks.push({
                    ...track,
                    equationPipelineUniqueField: step.field,
                    equationPipelineUniqueValue: uniqueValue,
                    equationPipelineUniqueLimit: step.maxPerUnique
                });
            }

            currentTracks = uniqueTracks;
            continue;
        }

        if (step.type === "show") {
            currentTracks = currentTracks.map(track => {
                const existingShowFields = Array.isArray(track.equationPipelineShowFields)
                    ? track.equationPipelineShowFields
                    : [];
                if (existingShowFields.includes(step.field)) {
                    return track;
                }

                return {
                    ...track,
                    equationPipelineShowFields: [...existingShowFields, step.field]
                };
            });
        }
    }

    return {
        usedPipeline: true,
        hasOrderingStep,
        tracks: currentTracks
    };
}
