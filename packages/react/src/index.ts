export {
  DashuResult,
  type DashuComponents,
  type DashuResultProps,
  type RenderProps,
} from "./dashu-result";
export { DashuComposer, type DashuComposerProps } from "./dashu-composer";
export {
  useDashu,
  type DashuErrorPayload,
  type UseDashu,
  type UseDashuOptions,
} from "./use-dashu";
export { Table, type TableProps } from "./Table";
export { Metric, type MetricProps } from "./Metric";
export { BarChart } from "./charts/BarChart";
export { LineChart } from "./charts/LineChart";
export { PieChart } from "./charts/PieChart";
export { ScatterChart } from "./charts/ScatterChart";
export {
  columnLabel,
  formatCell,
  formatValue,
  toLabel,
  toNumber,
  toPoints,
  type Point,
} from "./data";
export { seriesColor, token } from "./theme";
export { toCsv } from "./export";

// The contract the host renders. Re-exported so an application does not need a
// direct dependency on @rophpad/dashu-core to type its own components.
export type {
  AskResult,
  AskAnswered,
  AskUnanswerable,
  Cell,
  DisplayPlan,
  DisplaySpec,
  DisplayType,
  ResultColumn,
  ResultData,
} from "@rophpad/dashu-core";
