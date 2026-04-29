export default {
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    include: ["src/components/**/*.test.ts", "src/components/**/*.test.tsx"],
    exclude: ["src/__tests__/e2e/**", "node_modules/**"],
    environment: "node",
  },
};
