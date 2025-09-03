async function handleFdsQuery(req, res) {
    try {
        const { apiName } = req.params;
        const response = await fetch(`http://localhost:8080/${apiName}`, { method: 'GET' });

        const data = await response.text();

        res.set({'Content-Type': response.headers.get('content-type')});

        res.status(response.status).send(data);
    } catch (error) {

        res.status(500).json({
            error: 'Internal Server Error',
            details: 'An unexpected error occurred while processing the request'
        });
    }
}

module.exports = { handleFdsQuery };
