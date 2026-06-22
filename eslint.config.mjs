import nextCoreWebVitals from "eslint-config-next/core-web-vitals"

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-page-custom-font": "off",
      // These React Compiler diagnostics are enabled by the Next 16 preset, but
      // this app's existing data-loading effects intentionally update component
      // state. Keep the standard Hooks rules active while the components are
      // incrementally refactored for the compiler.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
]

export default eslintConfig
