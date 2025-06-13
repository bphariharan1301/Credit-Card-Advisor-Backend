// server.js or app.js (Main Express server file)
const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Import route handlers
const queryHandler = require("./routes/query");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.post("/api/query", queryHandler);

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({ status: "OK", message: "Server is running" });
});

// Error handling middleware
app.use((error, req, res, next) => {
	console.error("Global error handler:", error);
	res.status(500).json({
		error: "Internal server error",
		message:
			process.env.NODE_ENV === "development"
				? error.message
				: "Something went wrong",
	});
});

// 404 handler
app.use((req, res) => {
	res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
	console.log(`Credit Card Query API server running on port ${PORT}`);
	console.log(`Health check: http://localhost:${PORT}/health`);
	console.log(`Query endpoint: http://localhost:${PORT}/api/query`);
});

module.exports = app;
