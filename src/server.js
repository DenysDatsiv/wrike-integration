// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(cors());

/* -------------------- Data -------------------- */
// Generate 1200 CSS-related items
const ITEM_TYPES = ['article', 'person', 'product'];

const ITEMS = Array.from({ length: 1200 }, (_, index) => {
    const id = index + 1;
    const type = ITEM_TYPES[index % ITEM_TYPES.length];

    const title = `CSS resource ${id} – advanced CSS techniques`;

    const summary = [
        `This is CSS item #${id}, a detailed resource focused on modern layout techniques such as Flexbox, CSS Grid, and responsive typography.`,
        `The article walks through real-world patterns, including complex card layouts, dashboard grids, and adaptive components that behave well across different screen sizes.`,
        `You’ll also find notes on performance best practices, theming with custom properties (CSS variables), and how to debug tricky cascade and specificity issues in large codebases.`,
    ].join(' ');

    return {
        id: String(id),
        title,
        summary,
        link: `https://example.com/css-item-${id}`,
        type,
    };
});
const PDFS = [
    { id: 'p1',  title: 'Annual Report 2024',        summary: 'Company performance and outlook.', link: 'https://example.com/reports/annual-2024.pdf',  type: 'pdf' },
    { id: 'p2',  title: 'Kubernetes Cheatsheet',     summary: 'Commands and objects quick reference.', link: 'https://example.com/pdfs/k8s-cheatsheet.pdf', type: 'pdf' },
    { id: 'p3',  title: 'Node.js Best Practices',    summary: 'Patterns for scalable Node apps.', link: 'https://example.com/pdfs/node-best-practices.pdf', type: 'pdf' },
    { id: 'p4',  title: 'Intro to Prometheus',       summary: 'Metrics and alerting fundamentals.', link: 'https://example.com/pdfs/prometheus-intro.pdf', type: 'pdf' },
    { id: 'p5',  title: 'Grafana Dashboards Guide',  summary: 'Panels, variables, and templating.', link: 'https://example.com/pdfs/grafana-dashboards.pdf', type: 'pdf' },
    { id: 'p6',  title: 'Loki Log Pipeline',         summary: 'Ingest and query logs with Loki.', link: 'https://example.com/pdfs/loki-pipeline.pdf', type: 'pdf' },
    { id: 'p7',  title: 'Web Security Checklist',    summary: 'OWASP-style secure-by-default list.', link: 'https://example.com/pdfs/web-sec-checklist.pdf', type: 'pdf' },
    { id: 'p8',  title: 'TypeScript Handbook',       summary: 'Types, generics, narrowing, tips.', link: 'https://example.com/pdfs/typescript-handbook.pdf', type: 'pdf' },
    { id: 'p9',  title: 'CSS Layout Deep Dive Denys PDF TEST', summary: 'REST constraints and pitfalls.', link: 'https://example.com/pdfs/api-design-whitepaper.pdf', type: 'pdf' },
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
// GET /api/items?type=article,person&size=20&page=1&q=css
// Perfect for infinite scroll: just call with page = meta.nextPage while hasNext is true.
app.get('/api/items', (req, res) => {
    const { types, query, size, page } = parseQueryWithTypes(req.query, ['article', 'person', 'product']);
    const match = makeFuzzyMatcher(query);

    let data = ITEMS;
    if (types) data = data.filter(i => types.includes(i.type));
    if (query) data = data.filter(match);

    const total = data.length;
    const start = (page - 1) * size;
    const slice = data.slice(start, start + size);

    const hasNext = start + size < total;
    const hasPrev = page > 1;

    res.json({
        data: slice,
        meta: {
            total,
            page,
            size,
            hasNext,
            hasPrev,
            nextPage: hasNext ? page + 1 : null,
            prevPage: hasPrev ? page - 1 : null,
            query,
        },
    });
});

// GET /api/pdfs?size=10&page=1&q=css
app.get('/api/pdfs', (req, res) => {
    const { types, query, size, page } = parseQueryWithTypes(req.query, ['pdf']);
    const match = makeFuzzyMatcher(query);

    let data = PDFS;
    if (types) data = data.filter(i => types.includes(i.type)); // practically only 'pdf'
    if (query) data = data.filter(match);

    const total = data.length;
    const start = (page - 1) * size;
    const slice = data.slice(start, start + size);

    const hasNext = start + size < total;
    const hasPrev = page > 1;

    res.json({
        data: slice,
        meta: {
            total,
            page,
            size,
            hasNext,
            hasPrev,
            nextPage: hasNext ? page + 1 : null,
            prevPage: hasPrev ? page - 1 : null ,
            query,
        },
    });
});

/* -------------------- Start -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
