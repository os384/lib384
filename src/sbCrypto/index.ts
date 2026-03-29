/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
export { SBCrypto } from './SBCrypto';

import { SBCrypto } from './SBCrypto';

/**
 * This is the global SBCrypto object, which is instantiated
 * immediately upon loading the library.
 * 
 * You should use this and not instantiate your own. We don't
 * use static functions in SBCrypto(), because we want to be
 * able to add features (like global key store) incrementally.
 * 
 * @public
 */
export const sbCrypto = new SBCrypto();
