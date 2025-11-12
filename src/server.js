const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(cors());

const ITEMS = [
    { id: '1',  title: 'Intro to Web Security', summary: 'Best practices for securing web apps.', link: 'https://example.com/a1',  type: 'article' },
    { id: '2',  title: 'Ada Lovelace', summary: 'Pioneer of computing.', link: 'https://example.com/p1',  type: 'person' },
    { id: '3',  title: 'SuperWidget 3000', summary: 'A versatile productivity gadget.', link: 'https://example.com/pr1', type: 'product' },
    { id: '4',  title: 'Advanced Node.js Patterns', summary: 'Scalable patterns for Node apps.', link: 'https://example.com/a2', type: 'article' },
    { id: '5',  title: 'Grace Hopper', summary: 'COBOL and compiler pioneer.', link: 'https://example.com/p2', type: 'person' },
    { id: '6',  title: 'HyperPhone X', summary: 'A flagship smartphone.', link: 'https://example.com/pr2', type: 'product' },

    { id: '7',  title: 'Designing RESTful APIs', summary: 'Principles and pitfalls of REST.', link: 'https://example.com/a3', type: 'article' },
    { id: '8',  title: 'Alan Turing', summary: 'Father of theoretical computer science and AI.', link: 'https://example.com/p3', type: 'person' },
    { id: '9',  title: 'EcoBottle Pro', summary: 'Reusable insulated bottle.', link: 'https://example.com/pr3', type: 'product' },

    { id: '10', title: 'CSS Layout Deep Dive', summary: 'Grid, Flexbox, and modern layout patterns.', link: 'https://example.com/a4', type: 'article' },
    { id: '11', title: 'Katherine Johnson', summary: 'NASA mathematician who broke barriers.', link: 'https://example.com/p4', type: 'person' },
    { id: '12', title: 'SmartLamp Mini', summary: 'Portable lamp with ambient sensor.', link: 'https://example.com/pr4', type: 'product' },

    { id: '13', title: 'Effective Code Reviews', summary: 'How to review code with empathy and rigor.', link: 'https://example.com/a5', type: 'article' },
    { id: '14', title: 'Linus Torvalds', summary: 'Creator of Linux kernel and Git.', link: 'https://example.com/p5', type: 'person' },
    { id: '15', title: 'NoiseCancel Buds', summary: 'Wireless earbuds with ANC.', link: 'https://example.com/pr5', type: 'product' },

    { id: '16', title: 'PostgreSQL Indexing 101', summary: 'Types of indexes and when to use them.', link: 'https://example.com/a6', type: 'article' },
    { id: '17', title: 'Margaret Hamilton', summary: 'Led Apollo flight software team.', link: 'https://example.com/p6', type: 'person' },
    { id: '18', title: 'TravelPack 40L', summary: 'Carry-on friendly modular backpack.', link: 'https://example.com/pr6', type: 'product' },

    { id: '19', title: 'Intro to Kubernetes', summary: 'Pods, services, and deployments explained.', link: 'https://example.com/a7', type: 'article' },
    { id: '20', title: 'Tim Berners-Lee', summary: 'Inventor of the World Wide Web.', link: 'https://example.com/p7', type: 'person' },
    { id: '21', title: 'HomeHub Router', summary: 'Wi-Fi 6 router with parental controls.', link: 'https://example.com/pr7', type: 'product' },

    { id: '22', title: 'Observability Basics', summary: 'Logs, metrics, and traces for modern apps.', link: 'https://example.com/a8', type: 'article' },
    { id: '23', title: 'Radia Perlman', summary: 'Mother of the Internet—Spanning Tree Protocol.', link: 'https://example.com/p8', type: 'person' },
    { id: '24', title: 'ErgoKey MK-II', summary: 'Split mechanical keyboard.', link: 'https://example.com/pr8', type: 'product' },

    { id: '25', title: 'Async JS Patterns', summary: 'Promises, async/await, and streams.', link: 'https://example.com/a9', type: 'article' },
    { id: '26', title: 'Guido van Rossum', summary: 'Creator of Python.', link: 'https://example.com/p9', type: 'person' },
    { id: '27', title: 'CleanWater Filter', summary: 'Sink-mounted water filter replacement.', link: 'https://example.com/pr9', type: 'product' },

    { id: '28', title: 'TypeScript Tips', summary: 'Types, generics, and narrowing tricks.', link: 'https://example.com/a10', type: 'article' },
    { id: '29', title: 'Barbara Liskov', summary: 'LSP and contributions to programming languages.', link: 'https://example.com/p10', type: 'person' },
    { id: '30', title: 'DeskMate Pro', summary: 'Adjustable standing desk converter.', link: 'https://example.com/pr10', type: 'product' },
];

/* -------------------- Helpers -------------------- */
function parseQuery(q) {
    const allowedTypes = new Set(['article', 'person', 'product']);

    let types = null;
    if (q.type) {
        types = String(q.type)
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(t => allowedTypes.has(t));
        if (!types.length) types = null;
    }

    const query = (q.q ?? '').toString().trim();
    const fuzz = clamp(parseFloat(q.fuzz ?? '0.6'), 0, 1); // similarity threshold
    const size = Math.max(1, Math.min(100, parseInt(q.size ?? '10', 10) || 10));
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    return { types, query, fuzz, size, page };
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, isNaN(n) ? min : n)); }

function normalize(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function tokenizeWords(s) {
    return normalize(s).split(/[^a-z0-9]+/i).filter(Boolean);
}

function trigrams(s) {
    const t = normalize(s);
    if (t.length < 3) return [t]; // short-circuit for tiny tokens
    const grams = [];
    for (let i = 0; i < t.length - 2; i++) grams.push(t.slice(i, i + 3));
    return grams;
}

function diceCoeff(aStr, bStr) {
    const a = trigrams(aStr);
    const b = trigrams(bStr);
    if (!a.length || !b.length) return 0;
    const freq = new Map();
    for (const g of a) freq.set(g, (freq.get(g) || 0) + 1);
    let inter = 0;
    for (const g of b) {
        const n = freq.get(g);
        if (n > 0) {
            inter++;
            freq.set(g, n - 1);
        }
    }
    // Dice: 2|A∩B| / (|A|+|B|)
    return (2 * inter) / (a.length + b.length);
}

function levDistance(a, b) {
    a = normalize(a); b = normalize(b);
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const temp = dp[j];
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
            prev = temp;
        }
    }
    return dp[n];
}

function fuzzyWordMatch(term, word, fuzz) {
    // Handle super short terms with tiny edit distance
    if (term.length <= 2) {
        const d = levDistance(term, word);
        return d <= 1; // allow one edit
    }
    // Otherwise, compare term vs word with trigram Dice
    return diceCoeff(term, word) >= fuzz;
}

function makeFuzzyMatcher(query, fuzz) {
    const terms = query ? tokenizeWords(query) : [];
    if (!terms.length) return () => true; // no query => allow all

    return (item) => {
        const hayWords = tokenizeWords(`${item.title} ${item.summary}`);
        // every term must match at least one word in hayWords
        return terms.every(term =>
            hayWords.some(word => fuzzyWordMatch(term, word, fuzz))
        );
    };
}

/* -------------------- Route -------------------- */
// GET /api/items?type=article,person&size=5&page=2&q=node paterns&fuzz=0.55
app.get('/api/items', (req, res) => {
    const { types, query, fuzz, size, page } = parseQuery(req.query);
    const match = makeFuzzyMatcher(query, fuzz);

    let data = ITEMS;
    if (types) data = data.filter(i => types.includes(i.type));
    if (query) data = data.filter(match);

    const total = data.length;
    const start = (page - 1) * size;
    const slice = data.slice(start, start + size);

    res.json({
        data: slice,
        meta: {
            total,
            page,
            size,
            hasNext: start + size < total,
            hasPrev: page > 1,
            query,
            fuzz
        },
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
