#!/usr/bin/env -S deno run

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
import { SB384, hydrateKey } from "../dist/384.esm.js"
import { assertRejects } from "@std/assert";

async function runTests01() {
    const K = await new SB384().ready;
    console.log("JWK from new key K:")
    console.log(K.jwkPrivate)

    console.log("\n", "'userPublicKey':")
    console.log(K.userPublicKey)

    // default for private key is that it is 'stand alone':
    console.log("\n", "'userPrivateKey':")
    console.log(K.userPrivateKey)

    // however, if we are keeping the public key anyway, we have
    // the advanced option of 'dehydrating' the private key:
    console.log("\n", "'userPrivateKeyDehydrated':")
    console.log(K.userPrivateKeyDehydrated)

    // to re-create an SB384() object, we would first have to rehydrate:
    // just using it will throw an error
    console.log("\n", 
        "This should output 'console.error', though the\n",
        "exception is suppressed (it's correct behavior):")
    await assertRejects(() => {
        return (new SB384(K.userPrivateKeyDehydrated).ready);
    });

    // but if we first hydrate the key
    const K2 = hydrateKey(K.userPrivateKeyDehydrated, K.userPublicKey)
    console.log("\n", "Rehydrated key K2:")
    console.log(K2)

    // we can then use it
    const K3 = await new SB384(K2).ready;
    console.log("\n", "Rehydrated key K3:")
    console.log(K3.jwkPrivate)

}

/*

    the above test should generate output something like this:

        ===================================================================================

        JWK from new key K:
        {
            crv: "P-384",
            ext: true,
            key_ops: [ "deriveKey" ],
            kty: "EC",
            x: "Jp3rqzFz64d7atLylFiYALLHcKauTcPYcr4Se2i9YgnGYZO6Br2idqwoZIraA8Jl",
            y: "dv_wEyQilGas1wo1y0pM8emM0HEEr2RB2GeQMKKm7lNCfV7uGeA6riN8TCIZRrlx",
            d: "oeQoJkoiUOvye96uVGMxlPef_QoqSAp6gqXsQy3Wb1G6buBdurXGoTp0Z4eTZLgJ"
        }

        'userPublicKey':
        PNk3JJudTYQbiLkkB4snIb2RFVxf52lAHCptz6p4RXACYmlGCVEi05sgzYJK9IauVfD61

        'userPrivateKey':
        Xj33JJudTYQbiLkkB4snIb2RFVxf52lAHCptz6p4RXACYmlvCmhQj46XDboyqZXpJc631tje6RIr6N65Evlgd2sxtK6slv0EELyHVW1aew1KsZzSZzhpmUlcp9JBGwvcVNH89

        'userPrivateKeyDehydrated':
        Xj3xmYI0k8kglbCyvx75lClMI2fONVoHyZD3G7ZYOS5tQ4ZFpxPF8aOwMrnQr2sFluwIZ
        parseSB384string() - you need to rehydrate first ('hydrateKey()')


        This should output 'console.error', though the
        exception is suppressed (it's correct behavior):
        parseSB384string() - you need to rehydrate first ('hydrateKey()')

        Rehydrated key K2:
        Xj33JJudTYQbiLkkB4snIb2RFVxf52lAHCptz6p4RXACYmlvCmhQj46XDboyqZXpJc631tje6RIr6N65Evlgd2sxtK6slv0EELyHVW1aew1KsZzSZzhpmUlcp9JBGwvcVNH89

        Rehydrated key K3:
        {
            crv: "P-384",
            ext: true,
            key_ops: [ "deriveKey" ],
            kty: "EC",
            x: "Jp3rqzFz64d7atLylFiYALLHcKauTcPYcr4Se2i9YgnGYZO6Br2idqwoZIraA8Jl",
            y: "dv_wEyQilGas1wo1y0pM8emM0HEEr2RB2GeQMKKm7lNCfV7uGeA6riN8TCIZRrlx",
            d: "oeQoJkoiUOvye96uVGMxlPef_QoqSAp6gqXsQy3Wb1G6buBdurXGoTp0Z4eTZLgJ"
        }

         ===================================================================================

 */


Deno.test("[fast] ECPointDecompress testing", async () => {
    await runTests01();
});

if (import.meta.main) { // tells Deno not to run this in the test suite
    console.log("\n",
        "===================================================================================\n",
        "===================================================================================\n")
    await runTests01();
    console.log("\n",
        "===================================================================================\n",
        "===================================================================================\n")
}
