/** Text rendered by an optional map tag layer. */
export interface TagOptions {
  text: string
  /** Position in map coordinates. */
  pos: [number, number]
  /** @default 0 */
  level?: 0 | 1 | 2
}
