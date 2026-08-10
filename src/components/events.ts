/**
 * Client-side event names.
 *
 * The composer is rendered by the bottom navigation in the root layout, while
 * the feed is a separate client component further down the tree. They have no
 * common React parent to lift state into, so a window event is the seam between
 * them — cheaper and less jarring than reloading the document.
 */

export const POST_CREATED_EVENT = "hot-takes:post-created";
