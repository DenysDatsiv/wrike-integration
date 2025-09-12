const REQUIRED_FIELDS = {
    title: "Title",
    dateOfPublication: "Date of publication",
    summary: "Summary",
    content: "Content",
    mediaType: "Media Type",
};

class ValidationError extends Error {
    constructor(message, field) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
    }
}

function validateTaskId(taskId) {

    if (!taskId) {
        throw new ValidationError('Task ID is required', 'taskId');
    }

    if (typeof taskId !== 'string') {
        throw new ValidationError('Task ID must be a string', 'taskId');
    }

    taskId = taskId.trim();

    return taskId.toUpperCase();
}

function validateStatusId(statusId) {
    if (!statusId) throw new ValidationError('Status ID is required', 'statusId');

    if (typeof statusId !== 'string') throw new ValidationError('Status ID must be a string', 'statusId');

    statusId = statusId.trim();

    if (!statusId) throw new ValidationError('Status ID cannot be empty or whitespace only', 'statusId');

    const statusIdPattern = /^[A-Z0-9]{8,20}$/i;

    if (!statusIdPattern.test(statusId)) {
        throw new ValidationError(
            'Status ID must be 8-20 alphanumeric characters',
            'statusId'
        );
    }

    return statusId;
}

const isValidDate = (v) => {
    if (!v) return false;
    const t = Date.parse(v);
    return Number.isFinite(t);
};

const validateRequired = (extracted) => {
    console.log(extracted);
    const missing = [];
    const issues = [];

    if (!extracted?.title?.trim()) missing.push(REQUIRED_FIELDS.title);
    if (!extracted?.summary?.trim()) missing.push(REQUIRED_FIELDS.summary);
    if (!extracted?.content?.trim()) missing.push(REQUIRED_FIELDS.content);
    if (!extracted?.mediaType?.trim()) missing.push(REQUIRED_FIELDS.mediaType);

    if (!extracted?.dateOfPublication) {
        missing.push(REQUIRED_FIELDS.dateOfPublication);
    } else if (!isValidDate(extracted.dateOfPublication)) {
        issues.push(`${REQUIRED_FIELDS.dateOfPublication} must be a valid date (YYYY-MM-DD recommended).`);
    }

    return { ok: missing.length === 0 && issues.length === 0, missing, issues };
};
const buildValidationComment = ({ missing, issues }) => {
    const parts = [];

    if (missing?.length) {
        const plural = missing.length > 1;
        parts.push(
            `⚠️ Note: ${plural ? "These fields are" : "This field is"} required and missing: <b><i>${missing.join(
                ", "
            )}</i></b><br/><br/>`
        );
    }

    return parts.join("\n");
};

module.exports = {
    ValidationError,
    validateTaskId,
    validateStatusId,
    buildValidationComment,
    isValidDate,
    REQUIRED_FIELDS,
    validateRequired
};