import { type SidePanelPages } from 'searm-shared/types';

export type PageLayoutSidePanelPage =
  | SidePanelPages.PageLayoutDashboardWidgetTypeSelect
  | SidePanelPages.PageLayoutTabSettings
  | SidePanelPages.DashboardChartSettings
  | SidePanelPages.DashboardIframeSettings
  | SidePanelPages.DashboardRecordTableSettings
  | SidePanelPages.RecordPageFieldsSettings
  | SidePanelPages.RecordPageFieldSettings
  | SidePanelPages.PageLayoutRecordPageWidgetTypeSelect;
