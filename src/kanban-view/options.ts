import {
  BACKGROUND_IMAGE_OPTION_KEY,
  COLUMN_ORDER_OPTION_KEY,
  LOCAL_CARD_ORDER_OPTION_KEY,
} from "./constants";

export function getKanbanViewOptions() {
  return [
    {
      key: COLUMN_ORDER_OPTION_KEY,
      displayName: "Column order",
      type: "text" as const,
      default: "",
      placeholder: "Managed by drag and drop",
      shouldHide: () => true,
    },
    {
      key: LOCAL_CARD_ORDER_OPTION_KEY,
      displayName: "Card order",
      type: "text" as const,
      default: "",
      placeholder: "Managed by drag and drop",
      shouldHide: () => true,
    },
    {
      key: BACKGROUND_IMAGE_OPTION_KEY,
      displayName: "Background image",
      type: "text" as const,
      default: "",
      placeholder: "https://... or vault/path.png",
    },
  ];
}
