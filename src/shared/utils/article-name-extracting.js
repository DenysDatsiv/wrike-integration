// export function extractFileNameFromUrl(url) {
//     const pathMatch = url.match(/\/article\/([^/]+)\/detail/);
//     if (!pathMatch || pathMatch.length < 2) {
//         throw new Error('Invalid URL format or missing "/article/xxx/detail" in the URL');
//     }
//     const fileName = pathMatch[1];
//     const sanitizedFileName = fileName.replace(/[^\w\s]/gi, '_');
//     return sanitizedFileName;
// }