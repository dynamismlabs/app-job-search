/**
 * The building blocks Job Search's screens were written with: Ri's former app
 * kit UI (`@ri/app-kit/ui`, removed from Ri), kept in the app so the screens
 * keep their look and behavior. Browser only. The host bridge (app.tsx) is
 * new and runs on App Builder's client.
 */
export const UI_KIT_VERSION = 1;

// Styles
export { baseStyles, installStyles } from "./styles.js";

// Connection and data (the bridge to App Builder's client)
export { RiAppProvider, useRiApp, useOptionalRiApp, useLocationMoves, assertHttpsUrl, directionsUrl, MAX_PROMPT_LENGTH } from "./app.js";
export type { RiApp, RiAppProviderProps, Theme, SelectedFile, DownloadRequest } from "./app.js";
export { useQuery, useMutation } from "./hooks.js";
export type { QueryResult, MutationResult } from "./hooks.js";
export { AppFrame, useAppLayout, useAppWidth, useLayout, useElementWidth, layoutForWidth, LAYOUT_BREAKPOINTS } from "./layout.js";
export type { AppLayout, AppFrameProps } from "./layout.js";
export { LiveRegion, useAnnounce } from "./announce.js";
export type { Announce, AnnounceOptions } from "./announce.js";

// Layout and navigation
export { AppShell, SectionTabs, SectionPanel, sectionTabId, Toolbar, SearchField, SegmentedControl, FilterChips } from "./navigation.js";
export type { AppShellProps, SectionTabItem, SectionTabsProps, SearchFieldProps, SegmentedOption, FilterChipItem } from "./navigation.js";
export { SplitView, Inspector, useSplitMode } from "./split-view.js";
export type { SplitViewProps, InspectorProps } from "./split-view.js";

// Content
export { Button, ButtonRow } from "./button.js";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./button.js";
export { StatusLabel, Notice, EmptyState, LoadingState, ErrorState, InlineError, ToneIcon } from "./feedback.js";
export type { Tone, NoticeProps, EmptyStateProps } from "./feedback.js";
export { KeyValueList, DataTable, Timeline, SourceLine, Avatar, AvatarLabel } from "./data-display.js";
export type { KeyValueItem, DataColumn, DataTableProps, DataTableSort, TimelineItem, TimelineProps, SourceLineProps } from "./data-display.js";
export { Menu } from "./menu.js";
export type { MenuItem, MenuProps } from "./menu.js";

// Forms and dialogs
export { Dialog } from "./dialog.js";
export type { DialogProps } from "./dialog.js";
export { Field, useField, TextInput, TextArea, Select, Checkbox, RadioGroup, DateInput, MoneyInput } from "./forms.js";
export type { FieldProps, TextInputProps, TextAreaProps, SelectProps, SelectOption, CheckboxProps, RadioOption, DateInputProps, MoneyInputProps, MoneyValue } from "./forms.js";

// Ri workflow composites
export { AskRiButton, FollowUpDialog, ConflictNotice, ReviewCompare, ShareScopeChooser } from "./workflow.js";
export type { AskRiButtonProps, FollowUpDialogProps, CreatedFollowUp, ConflictField, ConflictNoticeProps, CompareRow, ReviewCompareProps, ShareSource, ShareOperation, ShareScopeChooserProps } from "./workflow.js";
export { SourcesScreen, sourceStatusLabel } from "./sources-screen.js";
export type { SourcesScreenProps, SourceAccount, SourceImport, SourceShare, SourceStatus, HistoryDays } from "./sources-screen.js";

// Formatting
export { formatDate, formatDateRange, formatInstant, relativeDay, formatMoney, parseMoneyInput, minorToDecimal, currencyDigits, isCurrencyCode, plural, initialsFor, shortDateLabel } from "./format.js";
export type { MoneyParse } from "./format.js";

// Icons for app chrome. Each is decorative and needs adjacent text.
export {
  CheckIcon,
  WarningIcon,
  DangerIcon,
  InfoIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
  ExternalIcon,
  DocumentIcon,
} from "./icons.js";

