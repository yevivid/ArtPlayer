import antfu from "@antfu/eslint-config";

export default antfu({
    ignores: [
        "**/hint.less",
        // emscripten 生成的 WASM 胶水代码，不做 lint
        "**/wasm/similarity-gen.js",
    ],
    formatters: {
        css: true,
        html: true,
        markdown: 'prettier',
    },
    rules: {
        "eslint-comments/no-unlimited-disable": "off",
    },
});
