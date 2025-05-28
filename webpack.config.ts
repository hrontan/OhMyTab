import * as path from "path";
import { fileURLToPath } from "url";
import CopyPlugin from "copy-webpack-plugin";
import { type Configuration } from "webpack";
import webpack from "webpack";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Env {
  target?: string;
}

const webpackConfig: (env: Env) => Configuration = (env) => ({
  mode: process.env.NODE_ENV == "production" ? "production" : "development",
  entry: {
    background: path.join(__dirname, "src/background.ts"),
    options: path.join(__dirname, "src/options.ts"),
  },
  target: "node18",
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      "node:module": false,
    },
    fallback: {
      module: false,
    },
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          context: "public",
          from: ".",
          to: ".",
          globOptions: {
            ignore: ["**/public/*.json"],
          },
        },
        {
          context: "public",
          from: `${env.target}.json`,
          to: "manifest.json",
        },
      ],
    }),
    new webpack.IgnorePlugin({
      resourceRegExp: /^node:module$/,
    }),
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          "ts-loader",
          {
            loader: "ifdef-loader",
            options: {
              BROWSER: env.target,
            },
          },
        ],
        exclude: /node_modules/,
      },
    ],
  },
  experiments: {
    outputModule: true,
  },
  externals: {
    "node:module": "commonjs2 node:module",
  },
  optimization: {
    minimize: false,
    chunkIds: "deterministic",
  },
  output: {
    filename: "[name].mjs",
    path: path.resolve(__dirname, `dist_${env.target}`),
    library: {
      type: "module",
    },
    chunkFormat: "module",
    clean: true,
  },
});

export default webpackConfig;
