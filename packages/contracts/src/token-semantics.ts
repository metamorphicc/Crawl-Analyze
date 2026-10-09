// SPL Token-2022 ExtensionType: MetadataPointer = 18, TokenMetadata = 19.
// These store descriptive metadata; they do not change raw balances, transfers or mint/freeze
// authority. Fees, hooks, delegates, confidential balances and unknown extensions remain blocked.
export function supportedMintSemantics(extensions: readonly number[]): boolean {
  return extensions.every((type) => type === 18 || type === 19);
}
