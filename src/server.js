// server.js
const express = require('express');
const cors = require(`cors`);
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(cors());

/* -------------------- Data -------------------- */
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

const PDFS = [
    { id: 'p1',  title: 'Annual Report 2024',        summary: 'Company performance and outlook.', link: 'https://example.com/reports/annual-2024.pdf',  type: 'pdf' },
    { id: 'p2',  title: 'Kubernetes Cheatsheet',     summary: 'Commands and objects quick reference.', link: 'https://example.com/pdfs/k8s-cheatsheet.pdf', type: 'pdf' },
    { id: 'p3',  title: 'Node.js Best Practices',    summary: 'Patterns for scalable Node apps.', link: 'https://example.com/pdfs/node-best-practices.pdf', type: 'pdf' },
    { id: 'p4',  title: 'Intro to Prometheus',       summary: 'Metrics and alerting fundamentals.', link: 'https://example.com/pdfs/prometheus-intro.pdf', type: 'pdf' },
    { id: 'p5',  title: 'Grafana Dashboards Guide',  summary: 'Panels, variables, and templating.', link: 'https://example.com/pdfs/grafana-dashboards.pdf', type: 'pdf' },
    { id: 'p6',  title: 'Loki Log Pipeline',         summary: 'Ingest and query logs with Loki.', link: 'https://example.com/pdfs/loki-pipeline.pdf', type: 'pdf' },
    { id: 'p7',  title: 'Web Security Checklist',    summary: 'OWASP-style secure-by-default list.', link: 'https://example.com/pdfs/web-sec-checklist.pdf', type: 'pdf' },
    { id: 'p8',  title: 'TypeScript Handbook',       summary: 'Types, generics, narrowing, tips.', link: 'https://example.com/pdfs/typescript-handbook.pdf', type: 'pdf' },
    { id: 'p9',  title: 'API Design Whitepaper',     summary: 'REST constraints and pitfalls.', link: 'https://example.com/pdfs/api-design-whitepaper.pdf', type: 'pdf' },
    { id: 'p10', title: 'CI/CD with GitHub Actions', summary: 'Workflows, caching, matrix builds.', link: 'https://example.com/pdfs/gha-cicd.pdf', type: 'pdf' },
    { id: 'p11', title: 'Docker Fundamentals',       summary: 'Images, containers, Compose.', link: 'https://example.com/pdfs/docker-fundamentals.pdf', type: 'pdf' },
    { id: 'p12', title: 'PostgreSQL Tuning',         summary: 'Indexes, query plans, vacuuming.', link: 'https://example.com/pdfs/pgsql-tuning.pdf', type: 'pdf' },
    { id: 'p13', title: 'Async JS Patterns',         summary: 'Promises, streams, backpressure.', link: 'https://example.com/pdfs/async-js-patterns.pdf', type: 'pdf' },
    { id: 'p14', title: 'Cloud Cost Optimization',   summary: 'Tagging, rightsizing, autoscaling.', link: 'https://example.com/pdfs/cloud-costs.pdf', type: 'pdf' },
    { id: 'p15', title: 'Accessibility (WCAG) Guide',summary: 'Roles, ARIA, keyboard nav.', link: 'https://example.com/pdfs/a11y-wcag.pdf', type: 'pdf' },
    { id: 'p16', title: 'SRE Playbook',              summary: 'SLIs, SLOs, error budgets.', link: 'https://example.com/pdfs/sre-playbook.pdf', type: 'pdf' },
    { id: 'p17', title: 'Caching Strategies',        summary: 'CDN, ETags, stale-while-revalidate.', link: 'https://example.com/pdfs/caching-strategies.pdf', type: 'pdf' },
    { id: 'p18', title: 'Testing Pyramid',           summary: 'Unit, integration, E2E balance.', link: 'https://example.com/pdfs/testing-pyramid.pdf', type: 'pdf' },
    { id: 'p19', title: 'OAuth2 & OIDC',             summary: 'Flows, tokens, PKCE.', link: 'https://example.com/pdfs/oauth-oidc.pdf', type: 'pdf' },
    { id: 'p20', title: 'Event-Driven Architectures',summary: 'Queues, topics, idempotency.', link: 'https://example.com/pdfs/eda-basics.pdf', type: 'pdf' },
];

/* -------------------- Helpers -------------------- */
function parseQueryWithTypes(q, allowedTypes) {
    const allowed = new Set(allowedTypes);

    let types = null;
    if (q.type) {
        types = String(q.type)
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(t => allowed.has(t));
        if (!types.length) types = null;
    }

    const query = (q.q ?? '').toString().trim();
    const size  = Math.max(1, Math.min(100, parseInt(q.size ?? '10', 10) || 10));
    const page  = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    return { types, query, size, page };
}

// normalization / tokenization
function normalize(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}
function tokenizeWords(s) {
    return normalize(s).split(/[^a-z0-9]+/i).filter(Boolean);
}

// trigram dice + tiny edit distance for short terms
const DEFAULT_FUZZ = 0.6;
function trigrams(s) {
    const t = normalize(s);
    if (t.length < 3) return [t];
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
        if (n > 0) { inter++; freq.set(g, n - 1); }
    }
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
function fuzzyWordMatch(term, word) {
    if (term.length <= 2) return levDistance(term, word) <= 1; // short tokens
    const t = normalize(term), w = normalize(word);
    if (w.includes(t)) return true;                            // fast path
    return diceCoeff(term, word) >= DEFAULT_FUZZ;              // fuzzy
}
function makeFuzzyMatcher(query) {
    const terms = query ? tokenizeWords(query) : [];
    if (!terms.length) return () => true;
    return (item) => {
        const hayWords = tokenizeWords(`${item.title} ${item.summary}`);
        return terms.every(term => hayWords.some(word => fuzzyWordMatch(term, word)));
    };
}

/* -------------------- Routes -------------------- */
// GET /api/items?type=article,person&size=5&page=2&q=node paterns
app.get('/api/items', (req, res) => {
    const { types, query, size, page } = parseQueryWithTypes(req.query, ['article', 'person', 'product']);
    const match = makeFuzzyMatcher(query);

    let data = ITEMS;
    if (types) data = data.filter(i => types.includes(i.type));
    if (query) data = data.filter(match);

    const total = data.length;
    const start = (page - 1) * size;
    const slice = data.slice(start, start + size);

    res.json({
        data: slice,
        meta: { total, page, size, hasNext: start + size < total, hasPrev: page > 1, query },
    });
});

// GET /api/pdfs?type=pdf&size=5&page=2&q=security guide
app.get('/api/pdfs', (req, res) => {
    const { types, query, size, page } = parseQueryWithTypes(req.query, ['pdf']);
    const match = makeFuzzyMatcher(query);

    let data = PDFS;
    if (types) data = data.filter(i => types.includes(i.type)); // practically only 'pdf'
    if (query) data = data.filter(match);

    const total = data.length;
    const start = (page - 1) * size;
    const slice = data.slice(start, start + size);

    res.json({
        data: slice,
        meta: { total, page, size, hasNext: start + size < total, hasPrev: page > 1, query },
    });
});

/* -------------------- Start -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

