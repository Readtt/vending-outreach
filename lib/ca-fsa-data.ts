/**
 * Every Canadian forward sortation area, with the centre of each.
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   node --disable-warning=ExperimentalWarning scripts/build-ca-fsa.ts
 *
 * Source: GeoNames postal code data (https://www.geonames.org/), used under
 * the Creative Commons Attribution 4.0 licence. That attribution is a licence
 * condition, so it stays in this file and is shown to the user in the Find
 * businesses dialog, alongside OpenStreetMap's.
 *
 * 1652 FSAs. See `scripts/build-ca-fsa.ts` for why this ships with the
 * app instead of being looked up over the network, and `lib/ca-postal.ts` for
 * how a postal code is turned into a search centre.
 *
 * Columns, tab separated: FSA, latitude, longitude, province, place name.
 */

export const CA_FSA_ATTRIBUTION =
  "Canadian postal code locations from GeoNames (geonames.org), CC BY 4.0."

export const CA_FSA_COUNT = 1652

export const CA_FSA_TABLE = `A0A	47.2195	-53.1448	NL	Southeastern Avalon Peninsula (Ferryland)
A0B	47.3270	-53.6609	NL	Western Avalon Peninsula (Argentia)
A0C	48.3843	-53.9081	NL	Bonavista Peninsula (Bonavista)
A0E	47.5607	-54.7801	NL	Burin Peninsula (Marystown)
A0G	48.8657	-54.7296	NL	Northeast Newfoundland (Lewisporte)
A0H	48.4311	-56.1758	NL	Central Newfoundland (Bishops Falls)
A0J	49.5067	-56.2616	NL	Northern Newfoundland (Springdale)
A0K	52.7359	-57.9825	NL	Northwest Newfoundland/Eastern Labrador (Mary's Harbour)
A0L	48.9445	-58.0645	NL	Western Newfoundland (Lark Harbour)
A0M	47.8037	-58.3869	NL	Southwestern Newfoundland (Channel-Port aux Basques)
A0N	48.0868	-57.8231	NL	Port au Port Peninsula region (St. George's)
A0P	54.9549	-61.6024	NL	Central Labrador (Happy Valley-Goose Bay)
A0R	53.5400	-65.1120	NL	North/Western Labrador (Churchill Falls)
A1A	47.5986	-52.6926	NL	St. John's North
A1B	47.5698	-52.7796	NL	St. John's Northwest Newfoundland & Labrador Provincial Government
A1C	47.5124	-52.6729	NL	St. John's North Central
A1E	47.5334	-52.7595	NL	St. John's Central
A1G	47.5060	-52.7603	NL	St. John's South
A1H	47.4830	-52.8415	NL	St. John's Southwest
A1K	47.6666	-52.7313	NL	Torbay
A1L	47.5291	-52.8814	NL	Paradise
A1M	47.6207	-52.8318	NL	Portugal Cove-St. Philips
A1N	47.5194	-52.8122	NL	Mount Pearl
A1S	47.4212	-52.8077	NL	Goulds
A1V	48.9682	-54.5906	NL	Gander
A1W	47.5096	-52.9447	NL	Manuels
A1X	47.4999	-52.9981	NL	Conception Bay
A1Y	47.7113	-53.2953	NL	Carbonear
A2A	48.9332	-55.6649	NL	Grand Falls
A2B	48.9499	-55.6649	NL	Windsor
A2H	48.9156	-57.7970	NL	Corner Brook
A2N	48.5500	-58.5818	NL	Stephenville
A2V	52.9517	-66.9328	NL	Labrador City
A5A	48.1666	-53.9648	NL	Clarenville
A8A	49.1667	-57.4316	NL	Deer Lake
B0C	46.6482	-60.5396	NS	North Victoria County (Dingwall)
B0E	46.1133	-61.0251	NS	West Cape Breton Island (Baddeck)
B0H	45.3335	-61.8333	NS	Canso region (Havre Boucher)
B0J	44.9419	-62.6471	NS	Mainland east shore (Lunenburg)
B0K	45.6138	-62.9506	NS	Southern Northumberland Strait (Pictou)
B0L	45.6908	-64.3641	NS	Isthmus of Chignecto (River Hébert)
B0M	45.5354	-64.0393	NS	Cobequid Bay north shore (Springhill)
B0N	45.0963	-63.4701	NS	Hants County (Shubenacadie)
B0P	45.0328	-64.6566	NS	Kings County (Kingston)
B0R	44.6003	-64.7443	NS	West Lunenburg County (New Germany)
B0S	44.6861	-65.3002	NS	West Annapolis County (Middleton)
B0T	44.0802	-65.1175	NS	Queens County (Shelburne)
B0V	44.5342	-65.7783	NS	Digby Neck (Digby)
B0W	44.0486	-65.7547	NS	Southwest Mainland (Weymouth)
B1A	46.1970	-59.9570	NS	Glace Bay
B1B	46.1174	-59.9144	NS	Port Morien
B1C	45.9485	-59.9737	NS	Louisbourg
B1E	46.1845	-60.0166	NS	Reserve Mines
B1G	46.2168	-60.0151	NS	Dominion
B1H	46.2501	-60.0817	NS	New Waterford
B1J	45.9834	-60.3652	NS	East Bay
B1K	45.9668	-60.2318	NS	Marion Bridge
B1L	46.0627	-60.2045	NS	Sydney Southwest
B1M	46.1270	-60.0696	NS	Sydney East
B1N	46.1975	-60.1559	NS	Sydney North
B1P	46.1341	-60.1749	NS	Sydney North Central
B1R	46.1284	-60.2915	NS	Sydney West
B1S	46.1109	-60.2092	NS	Sydney Central
B1T	45.9668	-60.7152	NS	Christmas Island
B1V	46.2437	-60.2313	NS	North Sydney North
B1W	45.9328	-60.6438	NS	Eskasoni
B1X	46.2904	-60.4700	NS	Big Bras d'Or
B1Y	46.2538	-60.3566	NS	Alder Point
B2A	46.1169	-60.3769	NS	North Sydney South Central
B2C	45.9948	-60.8421	NS	Iona
B2E	45.7501	-60.6152	NS	Loch Lomond
B2G	45.6168	-61.9986	NS	Antigonish
B2H	45.5834	-62.6486	NS	New Glasgow
B2J	45.7070	-60.4665	NS	Fourchu
B2N	45.3668	-63.2654	NS	Truro
B2R	44.7599	-63.5525	NS	Waverley
B2S	45.0209	-63.5344	NS	Lantz
B2T	44.8749	-63.4689	NS	Enfield
B2V	44.6529	-63.4777	NS	Dartmouth Morris Lake
B2W	44.6752	-63.5077	NS	Dartmouth East Central
B2X	44.7020	-63.5330	NS	Dartmouth North Central
B2Y	44.6645	-63.5453	NS	Dartmouth South Central
B2Z	44.7227	-63.4223	NS	Dartmouth East
B3A	44.6819	-63.5768	NS	Dartmouth Southwest
B3B	44.7091	-63.5869	NS	Dartmouth Northwest
B3E	44.7722	-63.3361	NS	Porters Lake
B3G	44.6169	-63.4820	NS	Eastern Passage
B3H	44.6344	-63.5822	NS	Halifax Lower Harbour
B3J	44.6451	-63.5762	NS	Halifax Mid-Harbour Nova Scotia Provincial Government
B3K	44.6620	-63.6017	NS	Halifax Upper Harbour
B3L	44.6508	-63.6146	NS	Halifax Central
B3M	44.6784	-63.6582	NS	Halifax Bedford Basin
B3N	44.6310	-63.6405	NS	Halifax South Central
B3P	44.6139	-63.5946	NS	Halifax North West Arm
B3R	44.5939	-63.6031	NS	Halifax South
B3S	44.6533	-63.6675	NS	Halifax West
B3T	44.5683	-63.7306	NS	Lakeside
B3V	44.5199	-63.6064	NS	Harrietsfield
B3Z	44.6386	-63.8687	NS	Tantallon
B4A	44.7232	-63.6560	NS	Bedford Southeast
B4B	44.7509	-63.7711	NS	Bedford Northwest
B4C	44.7607	-63.6370	NS	Lower Sackville South
B4E	44.8163	-63.7387	NS	Lower Sackville West
B4G	44.8814	-63.6798	NS	Lower Sackville North
B4H	45.8335	-64.1987	NS	Amherst
B4N	45.0834	-64.4988	NS	Kentville
B4P	45.0834	-64.3655	NS	Wolfville
B4R	45.0668	-64.5821	NS	Coldbrook
B4V	44.3835	-64.5155	NS	Bridgewater
B5A	43.8335	-66.1156	NS	Yarmouth
B6L	45.4093	-63.2114	NS	Truro
B9A	45.6168	-61.3485	NS	Port Hawkesbury
C0A	46.1668	-62.6487	PE	Kings and Queens counties (Elmira)
C0B	46.6023	-63.9583	PE	Prince County (Portage)
C1A	46.2716	-63.0165	PE	Charlottetown Southeast Prince Edward Island Provincial Government
C1B	46.2179	-63.0795	PE	Stratford
C1C	46.2645	-63.0842	PE	Charlottetown North
C1E	46.3451	-63.2011	PE	Charlottetown West
C1N	46.3959	-63.7876	PE	Summerside
E1A	46.0967	-64.7087	NB	Dieppe Moncton East
E1B	46.0545	-64.8160	NB	Riverview
E1C	46.0987	-64.8036	NB	Moncton Central
E1E	46.0771	-64.8529	NB	Moncton West
E1G	46.1797	-64.9484	NB	Moncton Northwest
E1H	46.1732	-64.6957	NB	Lakeville, Shediac Bridge
E1J	45.9976	-64.8483	NB	Coverdale
E1N	46.9501	-65.3239	NB	Miramichi South
E1V	47.1942	-65.9381	NB	Miramichi North
E1W	47.7941	-64.9386	NB	Caraquet
E1X	47.5144	-64.9181	NB	Tracadie-Sheila
E2A	47.6181	-65.6511	NB	Bathurst
E2E	45.4137	-65.9820	NB	Rothesay, Quispamsis
E2G	45.4534	-65.9310	NB	Quispamsis
E2H	45.3500	-66.0101	NB	Saint John Northeast, Renforth
E2J	45.2563	-65.9432	NB	Saint John East
E2K	45.3053	-66.0808	NB	Saint John North
E2L	45.2717	-66.0584	NB	Saint John Central
E2M	45.2347	-66.1749	NB	Saint John West
E2N	45.3176	-65.9271	NB	Saint John Lakewood
E2P	45.2426	-65.9847	NB	Saint John Red Head
E2R	46.0368	-66.0373	NB	Saint John Grandview
E2S	45.3371	-65.8133	NB	Saint John Loch Lomond
E2V	45.8351	-66.4792	NB	Oromocto
E3A	46.0401	-66.3862	NB	Fredericton North
E3B	45.8119	-66.6763	NB	Fredericton South New Brunswick Provincial Government
E3C	45.9020	-66.7057	NB	Fredericton Southwest, New Maryland
E3E	45.8834	-66.9156	NB	Kingsclear
E3G	46.0546	-66.7344	NB	Fredericton
E3L	45.1804	-67.2953	NB	St. Stephen
E3N	48.0075	-66.6727	NB	Campbellton
E3V	47.3737	-68.3251	NB	Edmundston
E3Y	47.1683	-67.6207	NB	Grand Falls Northeast
E3Z	46.9266	-67.7466	NB	Grand Falls Central
E4A	46.1599	-65.8102	NB	Bathurst
E4B	46.0848	-66.0622	NB	Minto
E4C	45.8693	-65.9006	NB	Youngs Cove
E4E	45.7227	-65.5066	NB	Sussex
E4G	45.8552	-65.4795	NB	Smiths Creek
E4H	45.9199	-64.6552	NB	Hillsborough
E4J	46.0391	-65.0463	NB	Salisbury
E4K	45.9016	-64.5080	NB	Dorchester
E4L	45.9188	-64.3845	NB	Sackville
E4M	46.0919	-64.0173	NB	Bayfield
E4N	46.2129	-64.2784	NB	Cap-Pelé
E4P	46.2198	-64.5411	NB	Shediac
E4R	46.3324	-64.6187	NB	Cocagne
E4S	46.4684	-64.7390	NB	Bouctouche
E4T	46.3042	-64.9720	NB	Bass River
E4V	46.3629	-64.7499	NB	Saint-Antoine
E4W	46.6807	-64.8804	NB	Richibucto
E4X	46.7401	-64.9698	NB	St-Louis-de-Kent
E4Y	46.7345	-65.4270	NB	Rogersville
E4Z	45.9394	-65.1802	NB	Petitcodiac
E5A	45.3705	-67.1737	NB	Moores Mills
E5B	45.0845	-67.0617	NB	St. Andrews
E5C	45.1265	-66.8314	NB	St. George
E5E	44.8908	-66.9318	NB	Campobello Island
E5G	44.6976	-66.8065	NB	Grand Manan Island
E5H	45.1168	-66.6822	NB	Pennfield
E5J	45.1979	-66.4308	NB	Lepreau
E5K	45.3407	-66.2528	NB	Grand Bay-Westfield
E5L	45.6604	-66.6139	NB	Fredericton Junction
E5M	45.7701	-66.1617	NB	Gagetown
E5N	45.5288	-65.8535	NB	Hampton
E5P	45.7599	-65.6704	NB	Apohaqui
E5R	45.3510	-65.5457	NB	St. Martins
E5S	45.4098	-66.0932	NB	Kingston
E5T	45.6508	-65.7302	NB	Norton
E5V	44.9862	-66.9694	NB	Deer Island
E6A	46.4558	-66.4198	NB	Boiestown
E6B	46.3381	-66.9058	NB	Stanley
E6C	46.1168	-66.5989	NB	Durham Bridge
E6E	46.1307	-67.1962	NB	Millville
E6G	45.9967	-67.2403	NB	Nackawic
E6H	45.8954	-67.4678	NB	Canterbury
E6J	45.5923	-67.3070	NB	McAdam
E6K	45.7290	-67.0064	NB	Harvey
E6L	45.9881	-67.0338	NB	Burtts Corner
E7A	47.3000	-68.7487	NB	Baker Brook
E7B	47.5655	-68.3127	NB	Saint-Jacques
E7C	47.6583	-68.0684	NB	Saint-Basile
E7E	47.1730	-67.9247	NB	Saint-Leonard
E7G	46.9065	-67.3900	NB	Plaster Rock
E7H	46.7355	-67.7039	NB	Perth-Andover
E7J	46.5807	-67.5911	NB	Bath
E7K	46.3982	-67.7174	NB	Centreville
E7L	46.5528	-67.3050	NB	Florenceville
E7M	46.1580	-67.5838	NB	Woodstock
E7N	46.0555	-67.5839	NB	Debec
E7P	46.2999	-67.5167	NB	Hartland
E8A	47.5133	-67.3929	NB	Saint-Quentin
E8B	47.6446	-67.3434	NB	Kedgwick
E8C	48.0550	-66.3847	NB	Dalhousie
E8E	47.6790	-66.4342	NB	Balmoral
E8G	47.8023	-66.1243	NB	Belledune
E8J	47.7941	-65.8219	NB	Petit-Rocher
E8K	47.6913	-65.6989	NB	Beresford
E8L	47.4750	-65.4950	NB	Allardville
E8M	47.5765	-65.1379	NB	Saint-Isidore
E8N	47.8078	-65.1945	NB	Grande-Anse
E8P	47.6672	-64.8248	NB	Inkerman
E8R	47.6383	-65.1709	NB	Paquetville
E8S	47.7287	-64.7247	NB	Shippagan
E8T	47.7936	-64.6475	NB	Lamèque
E9A	47.0188	-64.9200	NB	Baie-Sainte-Anne
E9B	46.7398	-65.8319	NB	Blackville
E9C	46.5570	-66.1257	NB	Doaktown
E9E	46.8486	-65.6772	NB	Red Bank
E9G	47.2489	-65.0741	NB	Neguac
E9H	47.3528	-65.0538	NB	Brantville
G0A	47.3507	-71.2020	QC	Capitale-Nationale (Stoneham)
G0B	47.4501	-72.9913	QC	Cap-aux-Meules
G0C	48.3429	-65.5961	QC	Gaspésie-Sud (New Richmond)
G0E	48.9182	-65.3736	QC	Gaspésie-Nord (Grande-Vallée)
G0G	53.0413	-68.6884	QC	Côte-Nord/Anticosti (Schefferville)
G0H	49.3795	-67.8948	QC	Manicouagan (Baie-Trinité)
G0J	48.5246	-67.0565	QC	Gaspésie-Ouest (Causapscal)
G0K	48.1590	-68.1951	QC	Bas-St-Laurent-Est (Sainte-Luce)
G0L	47.7136	-69.1658	QC	Bas-St-Laurent-Ouest (Trois-Pistoles)
G0M	45.9718	-70.6565	QC	Région de Beauce (Saint-Prosper-De-Dorchester)
G0N	46.0988	-71.1248	QC	Chaudière-Sud (Disraeli)
G0P	46.0119	-71.7199	QC	Centre-du-Québec-Est (Saint-Valère)
G0R	46.7980	-70.3288	QC	Appalaches (La Pocatière)
G0S	46.4526	-71.4397	QC	Chaudière-Nord (Saint-Joseph-De-Beauce)
G0T	49.0143	-69.6231	QC	Le Fjord (Forestville)
G0V	50.1719	-70.6283	QC	Saguenay-Lac-St-Jean (Alouette)
G0W	49.8340	-72.2623	QC	Région de Mistassini (Chambord)
G0X	47.9168	-74.6159	QC	Mauricie (Parent)
G0Y	45.6242	-71.0191	QC	L'Erable (Nantes)
G0Z	46.1790	-72.1569	QC	Centre-du-Québec-Nord (Daveluyville)
G1A	46.8588	-71.1920	QC	Quebec Provincial Government
G1B	46.9263	-71.2258	QC	Beauport North
G1C	46.8801	-71.1960	QC	Beauport Central
G1E	46.8588	-71.1920	QC	Beauport South
G1G	46.8765	-71.2839	QC	Jean-Talon Southeast
G1H	46.8528	-71.2573	QC	Charlesbourg South
G1J	46.8380	-71.2232	QC	Quebec City Lower Riverbank
G1K	46.8140	-71.2194	QC	Quebec City Mid-Riverbank
G1L	46.8304	-71.2455	QC	Quebec City Northeast
G1M	46.8183	-71.2706	QC	Quebec City North Central
G1N	46.8035	-71.2639	QC	Quebec City South Central
G1P	46.8097	-71.3102	QC	Quebec City West
G1R	46.8074	-71.2181	QC	Quebec City East
G1S	46.7933	-71.2453	QC	Quebec City South
G1T	46.7741	-71.2609	QC	Quebec City Upper Riverbank
G1V	46.7823	-71.2882	QC	Sainte-Foy Northeast
G1W	46.7589	-71.2980	QC	Sainte-Foy Southeast
G1X	46.7749	-71.3344	QC	Sainte-Foy West
G1Y	46.7507	-71.3562	QC	Cap-Rouge
G2A	46.8751	-71.3920	QC	Loretteville North
G2B	46.8505	-71.3357	QC	Loretteville South
G2C	46.8287	-71.3340	QC	Quebec City Northwest
G2E	46.8083	-71.3605	QC	L'Ancienne-Lorette Northeast
G2G	46.7903	-71.4157	QC	L'Ancienne-Lorette Southwest
G2J	46.8399	-71.2781	QC	Quebec City Inner North
G2K	46.8545	-71.3044	QC	Quebec City Outer North
G2L	46.8895	-71.2545	QC	Charlesbourg North
G2M	46.9220	-71.3056	QC	Jean-Talon Northeast
G2N	46.9137	-71.3398	QC	Jean-Talon West
G3A	46.7406	-71.4513	QC	St-Augustin-De-Desmaures
G3B	46.9833	-71.2906	QC	Lac-Beauport
G3C	47.1691	-71.4332	QC	Stoneham-et-Tewkesbury
G3E	46.8779	-71.3408	QC	Saint-Émile
G3G	46.9242	-71.3958	QC	Lac-Saint-Charles
G3H	46.7547	-71.6957	QC	Pont-Rouge
G3J	46.8603	-71.4752	QC	Val-Bélair North
G3K	46.8315	-71.4429	QC	Val-Bélair South
G3L	47.2374	-71.8763	QC	Saint-Raymond
G3M	46.6804	-71.7239	QC	Donnacona
G3N	46.8524	-71.6206	QC	Sainte-Catherine-de-la-Jacques-Cartier
G3S	46.8803	-71.5146	QC	Shannon
G3Z	47.4411	-70.4986	QC	Baie-Saint-Paul
G4A	47.7184	-70.2276	QC	Clermont
G4R	50.8558	-67.0511	QC	Sept-Îles Southeast
G4S	50.2713	-66.3751	QC	Sept-Îles Northwest
G4T	47.3999	-61.7996	QC	Les Îles-De-La-Madeleine
G4V	48.9711	-66.3082	QC	Sainte-Anne-Des-Monts
G4W	48.8286	-67.5220	QC	Matane
G4X	48.8334	-64.4819	QC	Gaspé
G4Z	51.0872	-68.6320	QC	Baie-Comeau Northeast
G5A	47.6575	-70.1559	QC	La Malbaie
G5B	50.0334	-66.8655	QC	Port-Cartier
G5C	50.3474	-69.0411	QC	Baie-Comeau Southwest
G5H	48.5839	-68.1921	QC	Mont-Joli
G5J	48.4638	-67.4313	QC	Amqui
G5L	48.4160	-68.5979	QC	Rimouski Central
G5M	48.4966	-68.4580	QC	Rimouski Northeast
G5N	48.3668	-68.4659	QC	Rimouski Southwest
G5R	47.8304	-69.5342	QC	Rivière-du-Loup
G5T	47.5473	-68.6431	QC	Degelis
G5V	46.9804	-70.5549	QC	Montmagny
G5X	46.2179	-70.7787	QC	Beauceville
G5Y	46.1326	-70.6375	QC	Saint-Georges Central
G5Z	46.0642	-70.7118	QC	Saint-Georges Southeast
G6A	46.1437	-70.6817	QC	Saint-Georges Northwest
G6B	45.5834	-70.8823	QC	Lac-Megantic
G6C	46.7701	-71.0906	QC	Pintendre
G6E	46.4340	-71.0117	QC	Sainte-Marie
G6G	46.0937	-71.3054	QC	Thetford Mines
G6H	46.0700	-71.4393	QC	Black Lake
G6J	46.6358	-71.3098	QC	Saint-Etienne-De-Lauzon
G6K	46.6880	-71.3028	QC	Saint-Redempteur
G6L	46.2186	-71.7620	QC	Plessisville
G6P	46.0529	-71.9477	QC	Victoriaville Central
G6R	46.0160	-71.9561	QC	Victoriaville South
G6S	46.0264	-71.8719	QC	Victoriaville East
G6T	46.0828	-71.9728	QC	Victoriaville Northwest
G6V	46.8033	-71.1779	QC	Lévis North
G6W	46.7546	-71.2200	QC	Lévis South
G6X	46.7151	-71.2612	QC	Charny
G6Y	46.8033	-71.1779	QC	Lévis
G6Z	46.6901	-71.1849	QC	Saint-Jean-Chrysostome
G7A	46.6842	-71.3827	QC	Saint-Nicolas
G7B	48.3398	-70.8893	QC	La Baie
G7G	48.4450	-71.1025	QC	Chicoutimi North
G7H	48.4187	-71.0417	QC	Chicoutimi East
G7J	48.4175	-71.1031	QC	Chicoutimi West
G7K	48.3689	-71.1175	QC	Chicoutimi Southwest
G7N	48.2007	-71.1426	QC	Laterrière
G7P	48.5501	-71.3158	QC	Saint-Ambroise
G7S	48.4294	-71.1774	QC	Jonquière Northeast
G7T	48.3975	-71.1527	QC	Jonquière Southeast
G7X	48.3199	-71.4149	QC	Jonquière Central
G7Y	48.3701	-71.2358	QC	Jonquière Southwest
G7Z	48.4381	-71.2642	QC	Jonquière Northwest
G8A	48.4233	-71.3629	QC	Jonquière West
G8B	48.5548	-71.6730	QC	Alma Southeast
G8C	48.5278	-71.6364	QC	Alma Southwest
G8E	48.6377	-71.6957	QC	Alma North
G8G	47.8076	-71.5907	QC	Métabetchouan-Lac-a-la-Croix
G8H	48.5168	-72.2324	QC	Roberval
G8J	48.5834	-72.3324	QC	Saint-Prime
G8K	48.6501	-72.4491	QC	Saint-Félicien
G8L	48.8763	-72.2120	QC	Dolbeau-Mistassini
G8M	48.8832	-72.4487	QC	Albanel
G8N	48.3473	-71.6786	QC	Hébertville
G8P	49.9168	-74.3659	QC	Chibougamau
G8T	46.3877	-72.5357	QC	Cap-de-la-Madeleine Central and southeast
G8V	46.4098	-72.4908	QC	Cap-de-la-Madeleine Northeast
G8W	46.4176	-72.6372	QC	Cap-de-la-Madeleine West
G8Y	46.3668	-72.6168	QC	Trois-Rivières Central
G8Z	46.3458	-72.5716	QC	Trois-Rivières Northeast
G9A	46.3695	-72.6789	QC	Trois-Rivières East
G9B	46.3160	-72.6833	QC	Trois-Rivières South
G9C	46.3922	-72.6725	QC	Trois-Rivières West
G9H	46.3334	-72.4324	QC	Becancour
G9N	46.5564	-72.7198	QC	Shawinigan Central
G9P	46.5068	-72.7436	QC	Shawinigan Southeast
G9R	46.6098	-72.8266	QC	Shawinigan Northwest
G9T	46.6315	-72.7370	QC	Grand-Mère
G9X	47.4334	-72.7824	QC	La Tuque
H0H	90.0000	0.0000	QC	Reserved (Santa Claus)
H0M	45.6986	-73.5025	QC	Akwesasne Region (Akwesasne)
H1A	45.6753	-73.5016	QC	Pointe-Aux-Trembles
H1B	45.6320	-73.5075	QC	Montreal East
H1C	45.6656	-73.5367	QC	Rivière-des-Prairies Northeast
H1E	45.6342	-73.5842	QC	Rivière-Des-Prairies Southwest
H1G	45.6109	-73.6211	QC	Montreal North North
H1H	45.5899	-73.6389	QC	Montreal North South
H1J	45.6097	-73.5794	QC	Anjou West
H1K	45.6097	-73.5472	QC	Anjou East
H1L	45.6043	-73.5178	QC	Mercier North
H1M	45.5883	-73.5572	QC	Mercier West
H1N	45.5779	-73.5304	QC	Mercier Southeast
H1P	45.5966	-73.5928	QC	Saint-Léonard North
H1R	45.5864	-73.6082	QC	Saint-Léonard West
H1S	45.5808	-73.5825	QC	Saint-Léonard Southeast
H1T	45.5730	-73.5701	QC	Rosemont North
H1V	45.5585	-73.5386	QC	Maisonneuve
H1W	45.5442	-73.5468	QC	Hochelaga
H1X	45.5583	-73.5701	QC	Rosemont Central
H1Y	45.5486	-73.5788	QC	Rosemont South
H1Z	45.5694	-73.6221	QC	Saint-Michel West
H2A	45.5618	-73.5990	QC	Saint-Michel East
H2B	45.5741	-73.6507	QC	Ahuntsic North
H2C	45.5606	-73.6584	QC	Ahuntsic Central
H2E	45.5514	-73.6116	QC	Villeray Northeast
H2G	45.5438	-73.5927	QC	Petite-Patrie Northeast
H2H	45.5374	-73.5735	QC	Plateau Mont-Royal North
H2J	45.5302	-73.5831	QC	Plateau Mont-Royal North Central
H2K	45.5307	-73.5547	QC	Centre-Sud North
H2L	45.5186	-73.5545	QC	Centre-Sud South
H2M	45.5528	-73.6411	QC	Ahuntsic East
H2N	45.5394	-73.6513	QC	Ahuntsic Southeast
H2P	45.5435	-73.6339	QC	Villeray West
H2R	45.5401	-73.6225	QC	Villeray Southeast
H2S	45.5354	-73.6061	QC	Petite-Patrie Southwest
H2T	45.5247	-73.5953	QC	Plateau Mont-Royal West
H2V	45.5168	-73.6072	QC	Outremont
H2W	45.5176	-73.5804	QC	Plateau Mont-Royal South Central
H2X	45.5115	-73.5683	QC	Plateau Mont-Royal Southeast
H2Y	45.5057	-73.5550	QC	Old Montreal
H2Z	45.5052	-73.5622	QC	Downtown Montreal Northeast
H3A	45.5040	-73.5747	QC	Downtown Montreal North
H3B	45.5005	-73.5684	QC	Downtown Montreal East
H3C	45.4980	-73.5472	QC	Griffintown (Includes Île Notre-Dame & Île Sainte-Hélène)
H3E	45.4594	-73.5501	QC	L'Île-Des-Soeurs
H3G	45.4987	-73.5793	QC	Downtown Montreal Southeast
H3H	45.5009	-73.5877	QC	Downtown Montreal South & West
H3J	45.4861	-73.5732	QC	Petite-Bourgogne
H3K	45.4805	-73.5554	QC	Pointe-Saint-Charles
H3L	45.5467	-73.6718	QC	Ahuntsic Southwest
H3M	45.5383	-73.6932	QC	Cartierville Northeast
H3N	45.5302	-73.6327	QC	Parc-Extension
H3P	45.5217	-73.6393	QC	Mount Royal North
H3R	45.5101	-73.6478	QC	Mount Royal Central
H3S	45.5063	-73.6297	QC	Côte-des-Neiges North
H3T	45.5018	-73.6191	QC	Côte-des-Neiges Northeast
H3V	45.4990	-73.6089	QC	Côte-des-Neiges East
H3W	45.4897	-73.6312	QC	Côte-des-Neiges Southwest
H3X	45.4819	-73.6421	QC	Hampstead
H3Y	45.4876	-73.6045	QC	Westmount West
H3Z	45.4825	-73.5933	QC	Westmount East
H4A	45.4717	-73.6149	QC	Notre-Dame-de-Grâce Northeast
H4B	45.4604	-73.6303	QC	Notre-Dame-de-Grâce Southwest
H4C	45.4737	-73.5882	QC	Saint-Henri
H4E	45.4546	-73.5985	QC	Ville Émard
H4G	45.4643	-73.5698	QC	Verdun North
H4H	45.4459	-73.5815	QC	Verdun South
H4J	45.5313	-73.7091	QC	Cartierville Central
H4K	45.5171	-73.7363	QC	Cartierville Southwest
H4L	45.5170	-73.6831	QC	Saint-Laurent Inner Northeast
H4M	45.4979	-73.6886	QC	Saint-Laurent East
H4N	45.5263	-73.6649	QC	Saint-Laurent Outer Northeast
H4P	45.4964	-73.6647	QC	Mount Royal South
H4R	45.5049	-73.7142	QC	Saint-Laurent Central
H4S	45.4858	-73.7433	QC	Saint-Laurent Southwest
H4T	45.4752	-73.6961	QC	Saint-Laurent Southeast
H4V	45.4671	-73.6487	QC	Côte-Saint-Luc East
H4W	45.4700	-73.6686	QC	Côte-Saint-Luc West
H4X	45.4529	-73.6492	QC	Montreal West
H4Y	45.8654	-72.7614	QC	Dorval Central
H4Z	45.5061	-73.5573	QC	Tour de la Bourse
H5A	45.4992	-73.5646	QC	Place Bonaventure
H5B	45.5066	-73.5623	QC	Place Desjardins
H7A	45.6739	-73.5924	QC	Duvernay-Est
H7B	45.6757	-73.6388	QC	Saint-Franþois
H7C	45.6168	-73.6492	QC	Saint-Vincent-de-Paul
H7E	45.6225	-73.6949	QC	Duvernay
H7G	45.5771	-73.6873	QC	Pont-Viau
H7H	45.6409	-73.7542	QC	Auteuil West
H7J	45.6625	-73.7002	QC	Auteuil Northeast
H7K	45.6213	-73.7398	QC	Auteuil South
H7L	45.6168	-73.7825	QC	Sainte-Rose
H7M	45.5984	-73.7159	QC	Vimont
H7N	45.5501	-73.6992	QC	Laval-des-Rapides
H7P	45.5780	-73.8004	QC	Fabreville
H7R	45.5526	-73.8507	QC	Laval-sur-le-Lac
H7S	45.5793	-73.7367	QC	Chomedey Northeast
H7T	45.5573	-73.7725	QC	Chomedey Northwest
H7V	45.5478	-73.7368	QC	Chomedey East
H7W	45.5338	-73.7652	QC	Chomedey South
H7X	45.5334	-73.8159	QC	Sainte-Dorothée
H7Y	45.5284	-73.8509	QC	Îles-Laval
H8N	45.4380	-73.6215	QC	LaSalle Northwest
H8P	45.4011	-73.6190	QC	LaSalle Southeast
H8R	45.3994	-73.6506	QC	Saint-Pierre
H8S	45.4402	-73.6747	QC	Lachine East
H8T	45.4419	-73.7057	QC	Lachine West
H8Y	45.5084	-73.8075	QC	Roxboro
H8Z	45.5069	-73.8407	QC	Pierrefonds
H9A	45.4948	-73.8317	QC	Dollard-Des-Ormeaux Northwest
H9B	45.4897	-73.7958	QC	Dollard-Des-Ormeaux East
H9C	45.5055	-73.8789	QC	L'Île Bizard Northeast
H9E	45.4865	-73.9092	QC	L'Île-Bizard Southwest
H9G	45.4756	-73.8367	QC	Dollard-Des-Ormeaux Southwest
H9H	45.4683	-73.8565	QC	Sainte-Geneviève
H9J	45.4501	-73.8659	QC	Kirkland
H9K	45.4577	-73.9162	QC	Senneville
H9P	45.4679	-73.7748	QC	Dorval Outskirts
H9R	45.4487	-73.8167	QC	Pointe-Claire
H9S	45.4414	-73.7749	QC	L'Île-Dorval
H9W	45.4334	-73.8659	QC	Beaconsfield
H9X	45.4062	-73.9456	QC	Sainte-Anne-De-Bellevue
J0A	45.8382	-71.9542	QC	Centre-du-Québec-Sud (Warwick)
J0B	45.1001	-72.0491	QC	Estrie-Est (Stanstead)
J0C	45.8567	-72.6966	QC	Centre-du-Québec-Ouest (Saint-Bonaventure)
J0E	45.2831	-72.5244	QC	Estrie-Ouest (Fulford)
J0G	46.0210	-72.8239	QC	Bois-Francs-Nord (Odanak)
J0H	45.6609	-72.7700	QC	Bois-Francs-Sud (Saint-Nazaire-D'Acton)
J0J	45.1529	-73.1636	QC	Montérégie-Est (Bedford)
J0K	46.7966	-73.8705	QC	Lanaudière-Nord (Saint-Esprit)
J0L	45.1956	-73.5695	QC	Montérégie-Nord (Saint-Antoine-Sur-Richelieu)
J0M	58.3269	-72.1637	QC	Nunavik (Kuujjuaq)
J0N	45.5135	-74.0534	QC	Région d'Oka (Oka)
J0P	45.3655	-74.3120	QC	Vaudreuil-Soulanges (Coteau-du-Lac)
J0R	45.8660	-74.1785	QC	Lanaudière-Sud (Prévost)
J0S	45.1082	-74.0451	QC	Montérégie-Ouest (Saint-Anicet)
J0T	46.3002	-74.5855	QC	Laurentides-Nord (Montcalm)
J0V	45.8265	-74.9318	QC	Laurentides-Sud (Chénéville)
J0W	47.0921	-75.7967	QC	Outaouais-Nord (Ferme-Neuve)
J0X	46.3070	-76.7653	QC	Outaouais-Sud (Thurso)
J0Y	52.1046	-75.2807	QC	Abitibi-Témiscamingue-Est (Radisson)
J0Z	47.8626	-78.8240	QC	Abitibi-Témiscamingue-Ouest (Guigues)
J1A	45.1334	-71.7991	QC	Coaticook
J1C	45.4797	-71.9492	QC	Bromptonville
J1E	45.4231	-71.8723	QC	Sherbrooke Northeast
J1G	45.4024	-71.8479	QC	Sherbrooke East
J1H	45.3891	-71.8986	QC	Sherbrooke Central
J1J	45.4131	-71.9238	QC	Sherbrooke North
J1K	45.3822	-71.9327	QC	Sherbrooke West
J1L	45.4113	-71.9586	QC	Sherbrooke Northwest
J1M	45.3656	-71.8420	QC	Sherbrooke Southeast
J1N	45.3395	-72.0128	QC	Rock Forest
J1R	45.3966	-72.0422	QC	Saint-Élie-d'Orford
J1S	45.5668	-71.9991	QC	Windsor
J1T	45.7668	-71.9324	QC	Asbestos
J1X	45.2668	-72.1491	QC	Magog
J1Z	45.9334	-72.4324	QC	Saint-Cyrille-De-Wendover
J2A	45.8152	-72.4027	QC	Drummondville Southeast
J2B	45.9061	-72.5929	QC	Drummondville South
J2C	45.8893	-72.5055	QC	Drummondville Central
J2E	45.9099	-72.5289	QC	Drummondville Northwest
J2G	45.4046	-72.7202	QC	Granby Central
J2H	45.3938	-72.7005	QC	Granby East
J2J	45.4005	-72.7825	QC	Granby West
J2K	45.2001	-72.7491	QC	Cowansville
J2L	45.3168	-72.6491	QC	Bromont
J2M	45.3501	-72.5658	QC	Shefford
J2N	45.2834	-72.9824	QC	Farnham
J2R	45.6567	-72.9237	QC	Saint-Hyacinthe Northwest
J2S	45.6139	-72.9912	QC	Saint-Hyacinthe Southwest
J2T	45.5971	-72.9366	QC	Saint-Hyacinthe East
J2W	45.3694	-73.3137	QC	Saint-Luc
J2X	45.3090	-73.2190	QC	Saint-Jean-sur-Richelieu East
J2Y	45.3114	-73.3556	QC	Saint-Jean-sur-Richelieu West
J3A	45.3339	-73.2744	QC	Saint-Jean-sur-Richelieu North
J3B	45.2832	-73.2792	QC	Saint-Jean-sur-Richelieu Central
J3E	45.5834	-73.3325	QC	Sainte-Julie
J3G	45.5946	-73.2283	QC	Beloeil West
J3H	45.5527	-73.1755	QC	Beloeil East
J3L	45.4501	-73.2825	QC	Chambly
J3M	45.4334	-73.1659	QC	Marieville
J3N	45.5334	-73.2825	QC	Saint-Basile-Le-Grand
J3P	46.0365	-73.0665	QC	Sorel Central
J3R	46.0206	-73.1439	QC	Sorel Southwest
J3T	46.2168	-72.6158	QC	Nicolet
J3V	45.5320	-73.3437	QC	Saint-Bruno
J3X	45.6834	-73.4325	QC	Varennes
J3Y	45.4906	-73.3991	QC	Saint-Hubert Central
J3Z	45.4981	-73.4012	QC	Saint-Hubert East
J4B	45.5910	-73.4361	QC	Boucherville
J4G	45.5679	-73.4761	QC	Longueuil North
J4H	45.5372	-73.5056	QC	Longueuil West
J4J	45.5362	-73.4721	QC	Longueuil Central
J4K	45.5183	-73.5023	QC	Longueuil Southwest
J4L	45.5181	-73.4576	QC	Longueuil Southeast
J4M	45.5418	-73.4382	QC	Longueuil East
J4N	45.5523	-73.4558	QC	Longueuil Northeast
J4P	45.5073	-73.5082	QC	Saint-Lambert North
J4R	45.4924	-73.5009	QC	Saint-Lambert Central
J4S	45.4810	-73.4970	QC	Saint-Lambert South
J4T	45.4973	-73.4676	QC	Saint-Hubert West
J4V	45.4865	-73.4622	QC	Greenfield Park
J4W	45.4674	-73.4832	QC	Brossard Northwest
J4X	45.4455	-73.4841	QC	Brossard Southwest
J4Y	45.4414	-73.4561	QC	Brossard South
J4Z	45.4424	-73.4231	QC	Brossard Northeast
J5A	45.3668	-73.5659	QC	Saint-Constant
J5B	45.3668	-73.5492	QC	Delson
J5C	45.4001	-73.5825	QC	Sainte-Catherine
J5J	45.8306	-73.9191	QC	Saint-Sophie
J5K	45.7334	-74.1325	QC	Saint-Colomban
J5L	45.7987	-74.0727	QC	Saint-Jérôme West
J5M	45.8501	-73.7659	QC	Saint-Lin-Laurentides
J5R	45.4168	-73.4992	QC	La Prairie
J5T	45.8834	-73.2825	QC	Lavaltrie
J5V	46.2559	-72.9415	QC	Louiseville
J5W	45.8232	-73.4294	QC	L'Assomption
J5X	45.8501	-73.4825	QC	L'Épiphanie
J5Y	45.7774	-73.4252	QC	Repentigny Northeast
J5Z	45.7643	-73.5036	QC	Repentigny West
J6A	45.7395	-73.4588	QC	Repentigny South
J6E	46.0168	-73.4492	QC	Joliette
J6J	45.3691	-73.7216	QC	Châteauguay North
J6K	45.3526	-73.7305	QC	Châteauguay South
J6N	45.3168	-73.8659	QC	Beauharnois
J6R	45.3168	-73.7492	QC	Mercier
J6S	45.2702	-74.0482	QC	Salaberry-de-Valleyfield North
J6T	45.2409	-74.1098	QC	Salaberry-de-Valleyfield South
J6V	45.7140	-73.5357	QC	Terrebonne East
J6W	45.7064	-73.6178	QC	Terrebonne Central
J6X	45.7275	-73.7062	QC	Terrebonne Northwest
J6Y	45.7000	-73.7520	QC	Terrebonne Southwest
J6Z	45.6694	-73.7752	QC	Sainte-Thérèse-de-Blainville Northeast
J7A	45.6383	-73.7975	QC	Sainte-Thérèse-de-Blainville East
J7B	45.6602	-73.8157	QC	Sainte-Thérèse-de-Blainville North
J7C	45.6890	-73.8671	QC	Sainte-Thérèse-de-Blainville Northwest
J7E	45.6442	-73.8448	QC	Sainte-Thérèse-de-Blainville Central
J7G	45.6095	-73.8378	QC	Sainte-Thérèse-de-Blainville South
J7H	45.6209	-73.8728	QC	Sainte-Thérèse-de-Blainville Southwest
J7J	45.7045	-73.9472	QC	Mirabel Northeast
J7K	45.7700	-73.6049	QC	Mascouche Extremities
J7L	45.7424	-73.6509	QC	Mascouche Central
J7M	45.7888	-73.7442	QC	La Plaine
J7N	45.6345	-74.1005	QC	Mirabel Southwest
J7P	45.5779	-73.8809	QC	Saint-Eustache Northeast
J7R	45.5740	-73.9400	QC	Saint-Eustache Southwest
J7T	45.3702	-74.1249	QC	Vaudreuil-Dorion RCM
J7V	45.4001	-74.0325	QC	Vaudreuil-Dorion
J7W	45.3665	-73.9736	QC	Pincourt
J7X	45.2691	-74.2339	QC	Valleyfield
J7Y	45.8058	-74.0165	QC	Saint-Jérôme North
J7Z	45.7788	-73.9829	QC	Saint-Jérôme Southeast
J8A	45.9334	-74.0159	QC	Saint-Hippolyte
J8B	45.9501	-74.1325	QC	Sainte-Adèle
J8C	46.0501	-74.2825	QC	Sainte-Agathe-Des-Monts
J8E	46.1949	-74.6264	QC	Mont-Tremblant
J8G	45.6834	-74.4159	QC	Chatham
J8H	45.6501	-74.3325	QC	Lachute
J8L	45.5856	-75.4208	QC	Buckingham
J8M	45.5435	-75.4274	QC	Masson-Angers
J8N	45.6501	-75.6660	QC	Val-des-Monts
J8P	45.4869	-75.6157	QC	Gatineau Southeast
J8R	45.5287	-75.6088	QC	Gatineau Northeast
J8T	45.4776	-75.7059	QC	Gatineau Southwest
J8V	45.5711	-75.7615	QC	Gatineau Northwest
J8X	45.4400	-75.7119	QC	Hull Southeast
J8Y	45.4480	-75.7434	QC	Hull Central
J8Z	45.4716	-75.7616	QC	Hull North
J9A	45.4279	-75.7711	QC	Hull Southwest
J9B	45.5001	-75.7827	QC	Chelsea
J9E	46.3834	-75.9660	QC	Maniwaki
J9H	45.3932	-75.8288	QC	Aylmer South
J9J	45.4394	-75.8465	QC	Aylmer North
J9L	46.5501	-75.4993	QC	Mont-Laurier
J9P	48.1002	-77.7828	QC	Val-d'Or
J9T	48.5669	-78.1162	QC	Amos
J9V	47.3334	-79.4330	QC	Ville-Marie
J9X	48.2855	-78.8234	QC	Rouyn-Noranda South
J9Y	48.1607	-79.0714	QC	Rouyn-Noranda North
J9Z	48.8002	-79.1996	QC	La Sarre
K0A	45.2557	-76.2754	ON	National Capital Region (Almonte)
K0B	45.5029	-74.7479	ON	Prescott and Russell United Counties (Alfred)
K0C	45.1686	-74.8966	ON	Stormont, Dundas and Glengarry United Counties (Alexandria)
K0E	44.8734	-75.4416	ON	South Leeds and Grenville United Counties (Prescott)
K0G	45.0466	-76.4757	ON	Rideau Lakes area (Kemptville)
K0H	44.7208	-76.8334	ON	Frontenac County, Addington County, Loyalist Shores and Southwest Leeds (Inverary)
K0J	45.6606	-77.5886	ON	Renfrew County and Lanark Highlands Township (Deep River)
K0K	44.3261	-77.4318	ON	Quinte Shores, East Northumberland County & Prince Edward County (Picton)
K0L	44.7767	-77.9687	ON	Peterborough County and North Hastings County (Lakefield)
K0M	44.8645	-78.6553	ON	Kawartha lakes and Haliburton County (Bobcaygeon)
K1A	45.4207	-75.7023	ON	Government of Canada Ottawa and Gatineau offices
K1B	45.4284	-75.5875	ON	Gloucester (Blackburn Hamlet / Pine View)
K1C	45.4677	-75.5399	ON	Gloucester (West Orleans)
K1E	45.4771	-75.5046	ON	Orleans (Queenswood)
K1G	45.3548	-75.5773	ON	Ottawa (Riverview / Hawthorne)
K1H	45.3876	-75.6593	ON	Ottawa (Alta Vista)
K1J	45.4519	-75.6036	ON	Gloucester (Beacon Hill / Cyrville)
K1K	45.4448	-75.6431	ON	Ottawa (Overbrook)
K1L	45.4400	-75.6630	ON	Ottawa (Vanier)
K1M	45.4491	-75.6818	ON	Ottawa (Rockcliffe Park / New Edinburgh)
K1N	45.4289	-75.6844	ON	Ottawa (Lower Town / Sandy Hill / University of Ottawa)
K1P	45.4225	-75.7026	ON	Ottawa (Parliament Hill)
K1R	45.4123	-75.7108	ON	Ottawa (West Downtown area)
K1S	45.3990	-75.6871	ON	Ottawa (The Glebe / Ottawa South / Ottawa East)
K1T	45.3295	-75.6156	ON	Gloucester (Blossom Park / Hunt Club East / Leitrim)
K1V	45.3281	-75.6719	ON	Ottawa (Riverside Park / Hunt Club West / Riverside South / YOW)
K1W	45.4365	-75.5158	ON	Gloucester (South Orleans)
K1X	45.2756	-75.6283	ON	Gloucester South
K1Y	45.4023	-75.7329	ON	Ottawa West
K1Z	45.3867	-75.7405	ON	Ottawa (Westboro)
K2A	45.3805	-75.7636	ON	Ottawa (Highland Park / Carlingwood)
K2B	45.3645	-75.7934	ON	Ottawa (Britannia / Pinecrest)
K2C	45.3679	-75.7381	ON	Ottawa (Queensway / Copeland / Carlington / Carleton Heights)
K2E	45.3438	-75.7157	ON	Nepean East
K2G	45.3211	-75.7391	ON	Nepean (Davidson Heights)
K2H	45.3433	-75.8265	ON	Nepean (Bells Corners)
K2J	45.2691	-75.7518	ON	Nepean (Barrhaven)
K2K	45.3704	-75.9198	ON	Kanata (Beaverbrook / South March)
K2L	45.3001	-75.9244	ON	Kanata (Katimavik-Hazeldean / Glen Cairn)
K2M	45.2861	-75.8562	ON	Kanata (Bridlewood)
K2P	45.4166	-75.6904	ON	Ottawa (Centre Town)
K2R	45.2899	-75.8126	ON	Nepean (Fallowfield Village / Cedarhill Estates / Orchard Estates)
K2S	45.2501	-75.9161	ON	Stittsville
K2T	45.3170	-75.9367	ON	Kanata (Marchwood)
K2V	45.2854	-75.8928	ON	Kanata (Terry Fox / Palladium)
K2W	45.3699	-75.9887	ON	Kanata (North March)
K4A	45.4697	-75.4715	ON	Orleans (Fallingbrook)
K4B	45.4101	-75.3638	ON	Cumberland Township
K4C	45.4980	-75.3916	ON	Cumberland
K4K	45.5501	-75.2910	ON	Rockland
K4M	45.2154	-75.6528	ON	Manotick
K4P	45.2434	-75.5674	ON	Greely
K4R	45.2388	-75.3527	ON	Russell
K6A	45.6001	-74.6160	ON	Hawkesbury
K6H	45.0565	-74.6852	ON	Cornwall East
K6J	45.0223	-74.7569	ON	Cornwall West
K6K	45.0610	-74.7774	ON	Cornwall North
K6T	44.6301	-75.7448	ON	Elizabethtown
K6V	44.6573	-75.7146	ON	Brockville
K7A	44.9001	-76.0161	ON	Smiths Falls
K7C	45.1334	-76.1494	ON	Carleton Place
K7G	44.3334	-76.1661	ON	Gananoque
K7H	44.9001	-76.2494	ON	Perth
K7K	44.2569	-76.4717	ON	Kingston (SW Pittsburgh Township)
K7L	44.2955	-76.4280	ON	Kingston (Downtown)
K7M	44.2411	-76.5788	ON	Kingston (Reddendale / Cataraqui / Collins Bay)
K7N	44.2224	-76.6500	ON	Amherstview
K7P	44.2814	-76.6111	ON	Kingston (Westbrook / Cataraqui Woods / Cedarwood)
K7R	44.2501	-76.9494	ON	Napanee
K7S	45.4334	-76.3494	ON	Arnprior
K7V	45.4668	-76.6827	ON	Renfrew
K8A	45.7466	-77.2047	ON	Pembroke Central and northern subdivisions
K8B	45.8080	-77.0806	ON	Pembroke (Pleasant View / Fairview)
K8H	45.8945	-77.2801	ON	Petawawa
K8N	44.1735	-77.3684	ON	Belleville East
K8P	44.1665	-77.4037	ON	Belleville West
K8R	44.1399	-77.4683	ON	Belleville (SE Sidney Township / Avondale)
K8V	44.0992	-77.5776	ON	Trenton
K9A	43.9598	-78.1651	ON	Cobourg
K9H	44.3245	-78.3184	ON	Peterborough North
K9J	44.3104	-78.2396	ON	Peterborough South
K9K	44.3138	-78.3606	ON	Peterborough (Fairbairn Meadows / Jackson Heights)
K9L	44.3552	-78.3199	ON	Peterborough (Terra View Heights / Woodland Acres / Donwood)
K9V	44.3501	-78.7329	ON	Lindsay
L0A	44.1263	-78.5193	ON	West Northumberland County (Millbrook)
L0B	44.0773	-78.7465	ON	East Durham Regional Municipality (Orono)
L0C	44.2094	-79.0725	ON	West Durham Regional Municipality (Sunderland)
L0E	44.3199	-79.2778	ON	Lake Simcoe Southeast Shore (Sutton West)
L0G	44.0586	-79.6235	ON	Ontario Centre (Queensville)
L0H	43.9023	-79.1554	ON	Whitby Region (Gormley)
L0J	43.8566	-79.6485	ON	North Peel Regional Municipality (Kleinburg)
L0K	44.6233	-79.1235	ON	Lake Simcoe North Shore (Coldwater)
L0L	44.4548	-79.7352	ON	Lake Simcoe West Shore (Oro)
L0M	44.3269	-80.0333	ON	Georgian Bay South Shore (Angus)
L0N	44.0317	-80.2068	ON	Dufferin County (Shelburne)
L0P	43.4906	-79.9998	ON	Halton Regional Municipality (Campbellville)
L0R	43.1607	-79.7463	ON	East Haldimand County (Waterdown)
L0S	42.9071	-79.0832	ON	Niagara Regional Municipality (Fonthill)
L1A	44.0168	-78.3995	ON	Port Hope
L1B	43.9235	-78.5457	ON	Bowmanville East
L1C	43.9714	-78.7095	ON	Bowmanville West
L1E	43.8969	-78.7683	ON	Courtice
L1G	43.9233	-78.8684	ON	Oshawa Central
L1H	43.9721	-78.8837	ON	Oshawa Southeast
L1J	43.8852	-78.8771	ON	Oshawa Southwest
L1K	43.9251	-78.8287	ON	Oshawa East
L1L	43.9581	-78.8972	ON	Oshawa North
L1M	43.9566	-78.9779	ON	Whitby North
L1N	43.8721	-78.9273	ON	Whitby Southeast
L1P	43.8866	-78.9750	ON	Whitby Southwest
L1R	43.9215	-78.9412	ON	Whitby Central
L1S	43.8404	-79.0251	ON	Ajax Southwest
L1T	43.8843	-79.0534	ON	Ajax Northwest
L1V	43.8605	-79.1618	ON	Pickering Southwest
L1W	43.8197	-79.0803	ON	Pickering South
L1X	43.8558	-79.0972	ON	Pickering Central
L1Y	43.9555	-79.1194	ON	Pickering North
L1Z	43.8773	-79.0055	ON	Ajax East
L2A	42.9001	-78.9329	ON	Fort Erie
L2E	43.0537	-79.1018	ON	Niagara Falls Central
L2G	43.0696	-79.0818	ON	Niagara Falls Southeast
L2H	43.1009	-79.1379	ON	Niagara Falls West
L2J	43.1296	-79.1034	ON	Niagara Falls North
L2M	43.1960	-79.2161	ON	St. Catharines Northeast
L2N	43.1923	-79.2559	ON	St. Catharines Northwest
L2P	43.1527	-79.2091	ON	St. Catharines East
L2R	43.1419	-79.2966	ON	St. Catharines Central
L2S	43.1447	-79.2634	ON	St. Catharines Southwest
L2T	43.1313	-79.2317	ON	St. Catharines South
L2V	43.1142	-79.2035	ON	St. Catharines Southeast
L2W	43.1688	-79.2794	ON	St. Catharines West
L3B	42.9878	-79.2219	ON	Welland East
L3C	42.9998	-79.2656	ON	Welland West
L3K	42.9001	-79.2329	ON	Port Colborne
L3M	43.2001	-79.5663	ON	Grimsby
L3P	43.8769	-79.2686	ON	Markham Central
L3R	43.8479	-79.3288	ON	Markham Outer Southwest
L3S	43.8486	-79.2617	ON	Markham Southeast
L3T	43.8227	-79.3946	ON	Thornhill East
L3V	44.6087	-79.4207	ON	Orillia
L3X	44.0433	-79.4912	ON	Newmarket Southwest
L3Y	44.0565	-79.4555	ON	Newmarket Northeast
L3Z	44.1168	-79.5663	ON	Bradford
L4A	43.9668	-79.2496	ON	Stouffville
L4B	43.8582	-79.3985	ON	Richmond Hill Southeast
L4C	43.8669	-79.4414	ON	Richmond Hill Southwest
L4E	43.9394	-79.4349	ON	Richmond Hill North
L4G	44.0001	-79.4663	ON	Aurora
L4H	43.8432	-79.5644	ON	Woodbridge North
L4J	43.8156	-79.4534	ON	Thornhill West
L4K	43.8001	-79.4829	ON	Concord
L4L	43.8064	-79.5995	ON	Woodbridge South
L4M	44.4001	-79.6663	ON	Barrie North
L4N	44.3572	-79.6929	ON	Barrie South
L4P	44.2501	-79.4663	ON	Keswick
L4R	44.7501	-79.8830	ON	Midland
L4S	43.8985	-79.4143	ON	Richmond Hill Central
L4T	43.7139	-79.6434	ON	Mississauga (Malton)
L4V	43.6935	-79.6069	ON	Mississauga (Wildwood)
L4W	43.6413	-79.6296	ON	Mississauga (Matheson / East Rathwood)
L4X	43.6178	-79.5786	ON	Mississauga (East Applewood / East Dixie / NE Lakeview)
L4Y	43.6028	-79.5929	ON	Mississauga (West Applewood / West Dixie / NW Lakeview)
L4Z	43.6192	-79.6538	ON	Mississauga (West Rathwood / East Hurontario / SE Gateway)
L5A	43.5883	-79.6091	ON	Mississauga (Mississauga Valleys / East Cooksville)
L5B	43.5771	-79.6306	ON	Mississauga (West Cooksville / Fairview / City Centre / East Creditview)
L5C	43.5624	-79.6504	ON	Mississauga (West Creditview / Mavis / Erindale)
L5E	43.5836	-79.5610	ON	Mississauga (Central Lakeview)
L5G	43.5647	-79.5852	ON	Mississauga (SW Lakeview / Mineola / East Port Credit)
L5H	43.5419	-79.6164	ON	Mississauga (West Port Credit / Lorne Park / East Sheridan)
L5J	43.5102	-79.6296	ON	Mississauga (Clarkson / Southdown)
L5K	43.5272	-79.6617	ON	Mississauga (West Sheridan)
L5L	43.5373	-79.6903	ON	Mississauga (Erin Mills / Western Business Park)
L5M	43.5637	-79.7202	ON	Mississauga (Churchill Meadows / Central Erin Mills / South Streetsville)
L5N	43.5924	-79.7611	ON	Mississauga (Lisgar / Meadowvale)
L5P	43.6904	-79.6238	ON	Mississauga (YYZ)
L5R	43.6060	-79.6708	ON	Mississauga (West Hurontario / SW Gateway)
L5S	43.6801	-79.6783	ON	Mississauga (Cardiff / NE Gateway)
L5T	43.6683	-79.6182	ON	Mississauga (Courtney Park / East Gateway)
L5V	43.5972	-79.6931	ON	Mississauga (East Credit)
L5W	43.6313	-79.7148	ON	Mississauga (Meadowvale Village / West Gateway)
L6A	43.8501	-79.5163	ON	Maple
L6B	43.9007	-79.2175	ON	Markham East
L6C	43.9045	-79.3392	ON	Markham Northwest
L6E	43.9002	-79.2676	ON	Markham Northeast
L6G	43.8485	-79.3346	ON	Markham Inner Southwest
L6H	43.4881	-79.7098	ON	Oakville North
L6J	43.4757	-79.6591	ON	Oakville Northeast
L6K	43.4396	-79.6878	ON	Oakville East
L6L	43.4032	-79.7186	ON	Oakville South
L6M	43.4464	-79.7593	ON	Oakville West
L6P	43.7942	-79.7021	ON	Brampton North
L6R	43.7592	-79.7605	ON	Brampton Northwest
L6S	43.7379	-79.7260	ON	Brampton North Central
L6T	43.7196	-79.6854	ON	Brampton East
L6V	43.7059	-79.7626	ON	Brampton Central
L6W	43.6800	-79.7273	ON	Brampton Southeast
L6X	43.6665	-79.8054	ON	Brampton Southwest
L6Y	43.6249	-79.7876	ON	Brampton South
L6Z	43.7328	-79.7953	ON	Brampton West Central
L7A	43.6909	-79.8377	ON	Brampton West
L7B	43.9286	-79.5269	ON	King City
L7C	43.8753	-79.8558	ON	Caledon
L7E	43.8795	-79.7379	ON	Bolton
L7G	43.6501	-79.9163	ON	Georgetown
L7J	43.6297	-80.0415	ON	Acton
L7K	43.8602	-79.9960	ON	Caledon Village
L7L	43.3799	-79.7668	ON	Burlington Northeast
L7M	43.4342	-79.8701	ON	Burlington North
L7N	43.3512	-79.7840	ON	Burlington East
L7P	43.3806	-79.8860	ON	Burlington West
L7R	43.3750	-79.8434	ON	Burlington Southeast
L7S	43.3230	-79.8092	ON	Burlington South
L7T	43.3081	-79.8507	ON	Burlington Southwest
L8B	43.3334	-79.8829	ON	Waterdown
L8E	43.2245	-79.6988	ON	Hamilton (Confederation Park / Nashdale / East Kentley / Riverdale / Lakely / Grayside / North Stoney Creek)
L8G	43.2164	-79.7423	ON	Hamilton (Greenford / North Gershome / West Stoney Creek)
L8H	43.2596	-79.7925	ON	Hamilton (West Kentley / McQuesten / Parkview / Hamilton Beach / East Industrial Sector / Normanhurst / Homeside / East Crown Point)
L8J	43.1836	-79.7210	ON	Hamilton (East Albion Falls / South Stoney Creek)
L8K	43.2211	-79.7994	ON	Hamilton (East Delta / Bartonville / Glenview / Rosedale / Lower King's Forest / Red Hill / Corman / Vincent / South Gershome)
L8L	43.2783	-79.8344	ON	Hamilton (West Industrial Sector / West Crown Point / North Stipley / North Gibson / Landsdale / Keith / North End / Beasley)
L8M	43.2441	-79.8359	ON	Hamilton (West Delta / Blakeley / South Stipley / South Gibson / St. Clair)
L8N	43.4017	-80.0170	ON	Hamilton (Stinson / Corktown)
L8P	43.2514	-79.8925	ON	Hamilton (Durand / Kirkendall / Chedoke Park)
L8R	43.2726	-79.8792	ON	Hamilton (Central / Strathcona / South Dundurn)
L8S	43.2606	-79.9161	ON	Hamilton (Westdale / Cootes Paradise / Ainslie Wood)
L8T	43.2199	-79.8286	ON	Hamilton (Sherwood / Huntington / Upper King's Forest / Lisgar / Berrisfield / Hampton Heights / Sunninghill)
L8V	43.2266	-79.8499	ON	Hamilton (Raleigh / Macassa / Lawfield / Thorner / Burkholme / Eastmount)
L8W	43.1958	-79.8458	ON	Hamilton (West Albion Falls / Hannon / Rymal / Trenholme / Quinndale / Templemead / Broughton / Eleanor / Randall / Rushdale / Butler / East Chappel)
L9A	43.2271	-79.8710	ON	Hamilton (Crerar / Bruleville / Hill Park / Inch Park / Centremount / Balfour / Greeningdon / Jerome)
L9B	43.2055	-79.9004	ON	Hamilton (Barnstown / West Chappel / Allison / Ryckmans / Mewburn / Sheldon / Falkirk / Carpenter / Kennedy / Southwest Outskirts)
L9C	43.2313	-79.9049	ON	Hamilton (Southam / Bonnington / Yeoville / Kernighan / Gourley / Rolston / Buchanan / Mohawk / Westcliffe / Gilbert / Gilkson / Gurnett / Fessenden / Mountview)
L9E	43.5168	-79.8829	ON	Milton
L9G	43.1836	-79.9902	ON	Ancaster West
L9H	43.2638	-79.9524	ON	Dundas
L9J	44.3186	-79.6761	ON	Barrie
L9K	43.2250	-79.9427	ON	Ancaster East
L9L	44.1068	-78.9444	ON	Port Perry
L9M	44.7834	-79.9164	ON	Penetanguishene
L9N	44.1149	-79.5014	ON	Holland Landing
L9P	44.1001	-79.1163	ON	Uxbridge
L9R	44.1501	-79.8663	ON	Alliston
L9S	44.3001	-79.6496	ON	Innisfil
L9T	43.5148	-79.8840	ON	Milton
L9V	43.9597	-80.1079	ON	Orangeville North
L9W	43.9702	-80.0160	ON	Orangeville South
L9X	44.4001	-79.6663	ON	Barrie
L9Y	44.4834	-80.2164	ON	Collingwood
L9Z	44.5168	-80.0164	ON	Wasaga Beach
M1B	43.8113	-79.1930	ON	Scarborough (Malvern / Rouge River)
M1C	43.7878	-79.1564	ON	Scarborough (Rouge Hill / Port Union / Highland Creek)
M1E	43.7678	-79.1866	ON	Scarborough (Guildwood / Morningside / Ellesmere)
M1G	43.7712	-79.2144	ON	Scarborough (Woburn)
M1H	43.7686	-79.2389	ON	Scarborough (Cedarbrae)
M1J	43.7464	-79.2323	ON	Scarborough (Eglinton)
M1K	43.7298	-79.2639	ON	Scarborough (Kennedy Park / Ionview / East Birchmount Park)
M1L	43.7122	-79.2843	ON	Scarborough (The Golden Mile / Clairlea / Oakridge / Birchmount Park East)
M1M	43.7247	-79.2312	ON	Scarborough (Cliffside / Cliffcrest / Scarborough Village West)
M1N	43.6952	-79.2646	ON	Scarborough (Birch Cliff / Cliffside West)
M1P	43.7612	-79.2707	ON	Scarborough (Dorset Park / Wexford Heights / Scarborough Town Centre)
M1R	43.7507	-79.3003	ON	Scarborough (Wexford / Maryvale)
M1S	43.7946	-79.2644	ON	Scarborough (Agincourt)
M1T	43.7812	-79.3036	ON	Scarborough (Clarks Corners / Tam O'Shanter / Sullivan)
M1V	43.8177	-79.2819	ON	Scarborough (Milliken / Agincourt North / Steeles East / L'Amoreaux East)
M1W	43.8016	-79.3216	ON	Scarborough (Steeles West / L'Amoreaux West)
M1X	43.8340	-79.2069	ON	Scarborough (Upper Rouge)
M2H	43.8015	-79.3577	ON	North York (Hillcrest Village)
M2J	43.7801	-79.3479	ON	North York (Fairview / Henry Farm / Oriole)
M2K	43.7797	-79.3813	ON	North York (Bayview Village)
M2L	43.7547	-79.3764	ON	North York (York Mills / Silver Hills)
M2M	43.7915	-79.4103	ON	Willowdale East (Newtonbrook)
M2N	43.7673	-79.4111	ON	Willowdale South
M2P	43.7500	-79.3978	ON	North York (York Mills West)
M2R	43.7786	-79.4450	ON	Willowdale West
M3A	43.7545	-79.3300	ON	North York (York Heights / Victoria Village / Parkway East)
M3B	43.7450	-79.3590	ON	Don Mills North
M3C	43.7334	-79.3329	ON	Don Mills South (Flemingdon Park)
M3H	43.7535	-79.4472	ON	North York (Armour Heights / Wilson Heights / Downsview North)
M3J	43.7694	-79.4921	ON	North York (Northwood Park / York University)
M3K	43.7390	-79.4692	ON	Downsview East (CFB Toronto)
M3L	43.7334	-79.5116	ON	Downsview West
M3M	43.7319	-79.4928	ON	Downsview Central
M3N	43.7568	-79.5210	ON	North York (Jane and Finch)
M4A	43.7276	-79.3148	ON	North York (Sweeney Park / Wigmore Park)
M4B	43.7063	-79.3094	ON	East York (Parkview Hill / Woodbine Gardens)
M4C	43.6913	-79.3116	ON	East York (Woodbine Heights)
M4E	43.6784	-79.2941	ON	East Toronto (The Beaches)
M4G	43.7124	-79.3644	ON	East York (Leaside)
M4H	43.7059	-79.3464	ON	East York (Thorncliffe Park)
M4J	43.6872	-79.3368	ON	East Toronto (The Danforth East)
M4K	43.6803	-79.3538	ON	East Toronto (The Danforth West / Riverdale)
M4L	43.6693	-79.3155	ON	East Toronto (India Bazaar / The Beaches West)
M4M	43.6561	-79.3406	ON	East Toronto (Studio District)
M4N	43.7301	-79.3935	ON	Central Toronto (Lawrence Park East)
M4P	43.7135	-79.3887	ON	Central Toronto (Davisville North)
M4R	43.7143	-79.4065	ON	Central Toronto (North Toronto West)
M4S	43.7020	-79.3853	ON	Central Toronto (Davisville)
M4T	43.6899	-79.3853	ON	Central Toronto (Moore Park / Summerhill East)
M4V	43.6861	-79.4025	ON	Central Toronto (Summerhill West / Rathnelly / South Hill / Forest Hill SE / Deer Park)
M4W	43.6827	-79.3730	ON	Downtown Toronto (Rosedale)
M4X	43.6684	-79.3689	ON	Downtown Toronto (St. James Town / Cabbagetown)
M4Y	43.6656	-79.3830	ON	Downtown Toronto (Church and Wellesley)
M5A	43.6555	-79.3626	ON	Toronto
M5B	43.6572	-79.3783	ON	Downtown Toronto (Ryerson)
M5C	43.6513	-79.3756	ON	Downtown Toronto (St. James Park)
M5E	43.6456	-79.3754	ON	Downtown Toronto (Berczy Park)
M5G	43.6564	-79.3860	ON	Downtown Toronto (Central Bay Street)
M5H	43.6496	-79.3833	ON	Downtown Toronto (Richmond / Adelaide / King)
M5J	43.6230	-79.3936	ON	Downtown Toronto (Harbourfront East / Union Station / Toronto Island)
M5K	43.6469	-79.3823	ON	Downtown Toronto (Toronto Dominion Centre / Design Exchange)
M5L	43.6492	-79.3823	ON	Downtown Toronto (Commerce Court / Victoria Hotel)
M5M	43.7335	-79.4177	ON	North York (Bedford Park / Lawrence Park West / Lawrence Manor East)
M5N	43.7113	-79.4195	ON	Central Toronto (Roselawn)
M5P	43.6966	-79.4120	ON	Central Toronto (Forest Hill North & West)
M5R	43.6736	-79.4035	ON	Central Toronto (The Annex / North Midtown / Yorkville)
M5S	43.6629	-79.3987	ON	Downtown Toronto (University of Toronto / Harbord)
M5T	43.6541	-79.3978	ON	Downtown Toronto (Kensington Market / Chinatown / Grange Park)
M5V	43.6404	-79.3995	ON	Downtown Toronto (CN Tower / King and Spadina / Railway Lands / Harbourfront West / Bathurst Quay / South Niagara / YTZ)
M5W	43.6437	-79.3787	ON	Downtown Toronto Stn A PO Boxes 25 The Esplanade (Enclave of M5E)
M5X	43.6492	-79.3823	ON	Downtown Toronto (Underground city)
M6A	43.7223	-79.4504	ON	North York (Lawrence Manor / Lawrence Heights)
M6B	43.7081	-79.4479	ON	North York (Glencairn)
M6C	43.6915	-79.4307	ON	York (Cedarvale)
M6E	43.6889	-79.4507	ON	York (Fairbank / Oakwood)
M6G	43.6683	-79.4205	ON	Downtown Toronto (Christie)
M6H	43.6655	-79.4378	ON	West Toronto (Dufferin / Dovercourt Village)
M6J	43.6480	-79.4177	ON	West Toronto (Rua Aþores / Trinity)
M6K	43.6383	-79.4301	ON	West Toronto (Brockton / Parkdale Village / Exhibition Place)
M6L	43.7137	-79.4869	ON	North York (North Park / Maple Leaf Park / Upwood Park)
M6M	43.6934	-79.4857	ON	York (Del Ray / Keelsdale / Mount Dennis / Silverthorne)
M6N	43.6748	-79.4839	ON	York (Runnymede / The Junction North)
M6P	43.6605	-79.4633	ON	West Toronto (High Park / The Junction South)
M6R	43.6469	-79.4521	ON	West Toronto (Parkdale / Roncesvalles Village)
M6S	43.6512	-79.4828	ON	West Toronto (Bloor West Village / Swansea)
M7A	43.6641	-79.3889	ON	Queen's Park Ontario Provincial Government
M7Y	43.7804	-79.2505	ON	East Toronto Business Reply Mail Processing Centre 969 Eastern (Enclave of M4L)
M8V	43.6075	-79.5013	ON	Etobicoke (New Toronto / Mimico South / Humber Bay Shores)
M8W	43.6021	-79.5402	ON	Etobicoke (Alderwood / Long Branch)
M8X	43.6518	-79.5076	ON	Etobicoke (The Kingsway / Montgomery Road / Old Mill North)
M8Y	43.6325	-79.4939	ON	Etobicoke (Old Mill South / King's Mill Park / Sunnylea / Humber Bay / Mimico NE / The Queensway East / Royal York South East / Kingsway Park South East)
M8Z	43.6256	-79.5231	ON	Etobicoke (Mimico NW / The Queensway West / South of Bloor / Kingsway Park South West / Royal York South West)
M9A	43.6662	-79.5282	ON	Etobicoke (Islington Avenue)
M9B	43.6505	-79.5517	ON	Etobicoke (West Deane Park / Princess Gardens / Martin Grove / Islington / Cloverdale)
M9C	43.6437	-79.5767	ON	Etobicoke (Eringate / Bloordale Gardens / Old Burnhamthorpe / Markland Woods)
M9L	43.7598	-79.5565	ON	North York (Humber Summit)
M9M	43.7366	-79.5401	ON	North York (Humberlea / Emery)
M9N	43.7068	-79.5170	ON	Weston
M9P	43.6949	-79.5323	ON	Etobicoke (Westmount)
M9R	43.6898	-79.5582	ON	Etobicoke (Kingsview Village / St. Phillips / Martin Grove Gardens / Richview Gardens)
M9V	43.7432	-79.5876	ON	Etobicoke (South Steeles / Silverstone / Humbergate / Jamestown / Mount Olive / Beaumond Heights / Thistletown / Albion Gardens)
M9W	43.7144	-79.5909	ON	Etobicoke Northwest (Clairville / Humberwood / Woodbine Downs / West Humber / Kipling Heights / Rexdale / Elms / Tandridge / Old Rexdale)
N0A	42.9403	-79.9450	ON	West Haldimand (Port Dover)
N0B	43.5569	-80.4414	ON	Wellington (Elora)
N0C	44.2561	-80.5029	ON	Georgian Bay Southwest Shore (Dundalk)
N0E	42.6618	-80.5572	ON	Brant and Norfolk (Waterford)
N0G	44.0024	-81.0676	ON	Huron (Wingham)
N0H	44.6941	-81.0962	ON	Bruce Peninsula (Wiarton)
N0J	42.9775	-80.7057	ON	Oxford (Norwich)
N0K	43.5067	-81.1582	ON	Perth (Mitchell)
N0L	42.7557	-81.4533	ON	Elgin (Dorchester)
N0M	43.2788	-81.5442	ON	Middlesex (Clinton)
N0N	42.9062	-82.1100	ON	Lambton (Forest)
N0P	42.4045	-81.9107	ON	Kent (Blenheim)
N0R	42.1783	-82.7715	ON	Essex (Belle River)
N1A	42.9001	-79.6163	ON	Dunnville
N1C	43.4921	-80.2267	ON	Guelph South
N1E	43.5677	-80.2418	ON	Guelph North
N1G	43.5184	-80.2257	ON	Guelph Central
N1H	43.5588	-80.3004	ON	Guelph Northwest
N1K	43.5260	-80.3051	ON	Guelph West
N1L	43.5160	-80.1900	ON	Guelph East
N1M	43.7001	-80.3664	ON	Fergus
N1P	43.3398	-80.2955	ON	Cambridge South
N1R	43.3666	-80.2239	ON	Cambridge Central
N1S	43.3592	-80.3347	ON	Cambridge Southwest
N1T	43.3849	-80.2833	ON	Cambridge East
N2A	43.4413	-80.4246	ON	Kitchener East
N2B	43.4646	-80.4467	ON	Kitchener Northeast
N2C	43.4182	-80.4451	ON	Kitchener South Central
N2E	43.4106	-80.5011	ON	Kitchener Southwest
N2G	43.4443	-80.4891	ON	Kitchener Central
N2H	43.4581	-80.4818	ON	Kitchener North Central
N2J	43.5040	-80.5366	ON	Waterloo Southeast
N2K	43.4961	-80.4936	ON	Kitchener North
N2L	43.4715	-80.5454	ON	Waterloo South
N2M	43.4363	-80.5093	ON	Kitchener Northwest
N2N	43.4260	-80.5438	ON	Kitchener West
N2P	43.3878	-80.4296	ON	Kitchener Southeast
N2R	43.3849	-80.4870	ON	Kitchener South
N2T	43.4530	-80.5692	ON	Waterloo Southwest
N2V	43.4764	-80.5842	ON	Waterloo Northwest
N2Z	44.1664	-81.6010	ON	Kincardine
N3A	43.4001	-80.6497	ON	Baden
N3B	43.6001	-80.5497	ON	Elmira
N3C	43.4389	-80.2649	ON	Cambridge Northeast
N3E	43.4193	-80.3505	ON	Cambridge Northwest
N3H	43.4267	-80.3699	ON	Cambridge West
N3L	43.2000	-80.3833	ON	Paris
N3P	43.1818	-80.2367	ON	Brantford Northeast
N3R	43.1692	-80.2684	ON	Brantford Central
N3S	43.1394	-80.2357	ON	Brantford Southeast
N3T	43.1310	-80.3254	ON	Brantford Southwest
N3V	43.1734	-80.2980	ON	Brantford Northwest
N3W	43.0668	-79.9329	ON	Caledonia
N3Y	42.8334	-80.2997	ON	Simcoe
N4B	42.8501	-80.4997	ON	Delhi
N4G	42.8599	-80.7262	ON	Tillsonburg
N4K	44.5672	-80.9435	ON	Owen Sound
N4L	44.6001	-80.5830	ON	Meaford
N4N	44.1501	-81.0330	ON	Hanover
N4S	43.1432	-80.7338	ON	Woodstock Central
N4T	43.1485	-80.7319	ON	Woodstock North
N4V	43.1150	-80.7430	ON	Woodstock South
N4W	43.7334	-80.9497	ON	Listowel
N4X	43.2655	-81.1687	ON	St. Mary's
N4Z	43.3634	-81.0069	ON	Stratford South
N5A	43.3668	-80.9497	ON	Stratford North
N5C	43.0334	-80.8830	ON	Ingersoll
N5H	42.7668	-80.9830	ON	Aylmer
N5L	42.6668	-81.2164	ON	Port Stanley
N5P	42.7779	-81.1769	ON	St. Thomas North
N5R	42.7597	-81.1762	ON	St. Thomas South
N5V	43.0233	-81.1643	ON	London (YXU / North and East Argyle / East Huron Heights)
N5W	42.9856	-81.1821	ON	London East (SW Argyle / Hamilton Road)
N5X	43.0443	-81.2391	ON	London (Fanshawe / Stoneybrook / Stoney Creek / Uplands / East Masonville)
N5Y	43.0123	-81.2307	ON	London (West Huron Heights / Carling)
N5Z	42.9660	-81.2053	ON	London (Glen Cairn)
N6A	42.9976	-81.2563	ON	London North (UWO)
N6B	42.9835	-81.2386	ON	London Central
N6C	42.9582	-81.2380	ON	London South (East Highland / North White Oaks / North Westminster)
N6E	42.9185	-81.2244	ON	London (South White Oaks / Central Westminster / East Longwoods / West Brockley)
N6G	43.0147	-81.3049	ON	London (Sunningdale / West Masonville / Medway / NE Hyde Park / East Fox Hollow)
N6H	42.9915	-81.3402	ON	London West (Central Hyde Park / Oakridge)
N6J	42.9546	-81.2735	ON	London (Southcrest / East Westmount / West Highland)
N6K	42.9536	-81.3418	ON	London (Riverbend / Woodhull / North Sharon Creek / Byron / West Westmount)
N6L	42.8719	-81.2472	ON	London (East Tempo)
N6M	42.9632	-81.1392	ON	London (Jackson / Old Victoria / Bradley / North Highbury)
N6N	42.8997	-81.1592	ON	London (South Highbury / Glanworth / East Brockley / SE Westminster)
N6P	42.8909	-81.3236	ON	London (Talbot / Lambeth / West Tempo / South Sharon Creek)
N7A	43.7501	-81.7165	ON	Goderich
N7G	42.9551	-81.6223	ON	Strathroy
N7L	42.4209	-82.1993	ON	Chatham Northwest
N7M	42.4238	-82.1183	ON	Chatham Southeast
N7S	42.9888	-82.3592	ON	Sarnia Central
N7T	42.9578	-82.2777	ON	Sarnia Southwest
N7V	42.9998	-82.3926	ON	Sarnia Northwest
N7W	42.9644	-82.3259	ON	Sarnia Southeast
N7X	43.0214	-82.3212	ON	Sarnia Northeast
N8A	42.5930	-82.3885	ON	Wallaceburg
N8H	42.0549	-82.6062	ON	Leamington
N8M	42.1751	-82.8248	ON	Essex
N8N	42.2946	-82.8667	ON	Tecumseh Outskirts
N8P	42.3276	-82.9104	ON	Windsor (East Riverside)
N8R	42.3067	-82.9150	ON	Windsor (East Forest Glade)
N8S	42.3283	-82.9472	ON	Windsor (Riverside)
N8T	42.3037	-82.9459	ON	Windsor (West Forest Glade / East Fontainbleu)
N8V	42.2773	-82.9447	ON	Tecumseh (YQG)
N8W	42.2836	-82.9771	ON	Windsor (South Walkerville / West Fontainbleu / Walker Farm / Devonshire)
N8X	42.2926	-83.0186	ON	Windsor South Central (West Walkerville / Remington Park)
N8Y	42.3176	-82.9929	ON	Windsor East (East Walkerville)
N9A	42.2007	-83.0276	ON	Windsor (City Centre / NW Walkerville)
N9B	42.2949	-83.0520	ON	Windsor (University / South Cameron)
N9C	42.2767	-83.0793	ON	Windsor (Sandwich / Ojibway / West Malden)
N9E	42.2652	-83.0314	ON	Windsor South (East Malden)
N9G	42.2481	-82.9952	ON	Windsor (Roseland)
N9H	42.2318	-83.0281	ON	La Salle East
N9J	42.2187	-83.0801	ON	La Salle West
N9K	42.2978	-82.8701	ON	Tecumseh Central
N9V	42.1168	-83.0498	ON	Amherstburg
N9Y	42.0502	-82.7598	ON	Kingsville
P0A	45.5881	-79.3546	ON	Nipissing Central (Burk's Falls)
P0B	45.1863	-79.4115	ON	Nipissing South (Utterson)
P0C	45.1275	-79.7860	ON	Parry Sound Mid-Shore (Bala)
P0E	44.8608	-79.5069	ON	Parry Sound South Shore (Kilworthy)
P0G	45.6718	-80.3688	ON	Parry Sound North Shore (Nobel)
P0H	46.3109	-79.3617	ON	Nipissing North (Callander)
P0J	47.5776	-80.2036	ON	Timiskaming South (Temiskaming Shores)
P0K	48.5234	-80.3081	ON	Timiskaming North (Iroquois Falls A)
P0L	51.9700	-83.5369	ON	Cochrane Region (Hearst)
P0M	47.6526	-82.4753	ON	Algoma, Sudbury District and Greater Sudbury (Chelmsford)
P0N	48.6027	-81.0115	ON	Timmins Region (South Porcupine)
P0P	45.7565	-82.2151	ON	Manitoulin (Little Current)
P0R	46.5984	-83.0385	ON	Algoma Southwest (Blind River)
P0S	48.0480	-84.6727	ON	Lake Superior East Shore (Wawa)
P0T	49.2924	-88.7560	ON	Lake Superior North Shore (Marathon)
P0V	52.9648	-90.1505	ON	Northwestern Ontario (Red Lake)
P0W	48.8750	-93.7522	ON	Rainy River Region (Emo)
P0X	50.9293	-93.3095	ON	Kenora Region (Keewatin)
P0Y	49.7603	-95.1003	ON	Lake of the Woods East Shore (Ingolf)
P1A	46.2801	-79.4502	ON	North Bay South
P1B	46.3364	-79.5830	ON	North Bay Central
P1C	46.3397	-79.4223	ON	North Bay North
P1H	45.3334	-79.2163	ON	Huntsville
P1L	45.0334	-79.3163	ON	Bracebridge
P1P	44.9168	-79.3663	ON	Gravenhurst
P2A	45.3501	-80.0330	ON	Parry Sound
P2B	46.3668	-79.9164	ON	Sturgeon Falls
P2N	48.1446	-80.0377	ON	Kirkland Lake
P3A	46.5187	-80.9340	ON	Greater Sudbury (New Sudbury)
P3B	46.4847	-80.9304	ON	Greater Sudbury (Downtown / Minnow Lake)
P3C	46.5133	-81.0225	ON	Greater Sudbury (Gatchell / West End / Little Britain)
P3E	46.2676	-80.9063	ON	Greater Sudbury (Robinson / Lockerby)
P3G	46.4031	-80.9745	ON	Greater Sudbury (Lo-Ellen / McFarlane Lake)
P3L	46.5942	-80.8500	ON	Greater Sudbury (Garson)
P3N	46.5845	-81.0029	ON	Greater Sudbury (Val Caron)
P3P	46.7259	-81.0166	ON	Greater Sudbury (Hanmer)
P3Y	46.4431	-81.1270	ON	Greater Sudbury (Lively)
P4N	48.4669	-81.3331	ON	Timmins Southeast
P4P	48.4985	-81.3448	ON	Timmins North
P4R	48.4702	-81.3997	ON	Timmins West
P5A	46.3834	-82.6332	ON	Elliot Lake
P5E	46.2584	-81.7665	ON	Espanola
P5N	49.4169	-82.4331	ON	Kapuskasing
P6A	46.5168	-84.3333	ON	Sault Ste. Marie East
P6B	46.5307	-84.3046	ON	Sault Ste. Marie Central
P6C	46.5353	-84.3732	ON	Sault Ste. Marie North
P7A	48.4601	-89.2035	ON	Thunder Bay Northeast
P7B	48.9475	-89.4063	ON	Thunder Bay North Central
P7C	48.3520	-89.4649	ON	Thunder Bay Central
P7E	48.3684	-89.2840	ON	Thunder Bay South Central
P7G	48.4001	-89.3168	ON	Thunder Bay North
P7J	48.2834	-89.3668	ON	Thunder Bay South
P7K	48.3728	-89.3484	ON	Thunder Bay West
P7L	48.1668	-89.4168	ON	Neebing
P8N	49.7833	-92.7503	ON	Dryden
P8T	50.0668	-91.9836	ON	Sioux Lookout
P9A	48.6393	-93.4469	ON	Fort Frances
P9N	49.7573	-94.3427	ON	Kenora
R0A	49.2911	-96.2985	MB	Southeastern Manitoba (Lorette)
R0B	56.2701	-96.9118	MB	Northern Manitoba (Norway House)
R0C	51.4132	-97.8525	MB	North Interlake (Stonewall)
R0E	50.4751	-95.9610	MB	Eastern Manitoba (Beausejour)
R0G	49.4394	-98.0869	MB	South Central Manitoba (Altona)
R0H	50.3458	-98.5152	MB	South Interlake (MacGregor)
R0J	50.5842	-100.1345	MB	Riding Mountain (Neepawa)
R0K	49.5550	-99.7154	MB	Brandon Region (Killarney)
R0L	52.0092	-100.2901	MB	Western Manitoba (Swan River)
R0M	49.7110	-100.9263	MB	Southwestern Manitoba (Virden)
R1A	50.1436	-96.8845	MB	Selkirk
R1B	50.0840	-96.9353	MB	Lockport
R1C	50.0550	-96.9781	MB	Narol
R1N	49.9728	-98.2926	MB	Portage la Prairie
R2C	49.9247	-96.9563	MB	Winnipeg (Transcona)
R2E	49.9791	-97.0128	MB	East St. Paul
R2G	49.9413	-97.0571	MB	Winnipeg (River East North)
R2H	49.8846	-97.1186	MB	Winnipeg (St. Boniface NW)
R2J	49.8665	-97.0633	MB	Winnipeg (St. Boniface NE)
R2K	49.9203	-97.0830	MB	Winnipeg (River East Central)
R2L	49.9075	-97.0996	MB	Winnipeg (River East South)
R2M	49.8396	-97.1147	MB	Winnipeg (St. Vital North)
R2N	49.7838	-97.0973	MB	Winnipeg (St. Vital SW)
R2P	49.9696	-97.1554	MB	Winnipeg (Seven Oaks West)
R2R	49.9377	-97.2162	MB	Winnipeg (Inkster West)
R2V	49.9548	-97.1112	MB	Winnipeg (Seven Oaks East)
R2W	49.9195	-97.1354	MB	Winnipeg (Point Douglas East)
R2X	49.9322	-97.1733	MB	Winnipeg (Point Douglas West / Inkster East)
R2Y	49.9073	-97.2945	MB	Winnipeg (St. James-Assiniboia NW)
R3A	49.9038	-97.1489	MB	Winnipeg (Centennial)
R3B	49.8980	-97.1401	MB	Winnipeg (Chinatown / Civic Centre / Exchange District)
R3C	50.0110	-97.2184	MB	Winnipeg (Broadway / The Forks / Portage and Main) Manitoba Provincial Government
R3E	49.9081	-97.1779	MB	Winnipeg (Sargent Park / Daniel McIntyre / Inkster SE)
R3G	49.8876	-97.1807	MB	Winnipeg (Minto / St. Mathews / Wolseley)
R3H	49.9033	-97.2074	MB	Winnipeg (St. James-Assiniboia NE / YWG)
R3J	49.8966	-97.2404	MB	Winnipeg (St. James-Assiniboia SE)
R3K	49.8734	-97.3070	MB	Winnipeg (St. James-Assiniboia SW)
R3L	49.8670	-97.1356	MB	Winnipeg (River Heights East)
R3M	49.8625	-97.1665	MB	Winnipeg (River Heights Central)
R3N	49.8629	-97.1959	MB	Winnipeg (River Heights West)
R3P	49.8425	-97.2182	MB	Winnipeg (Fort Garry NW / Tuxedo)
R3R	49.8546	-97.2874	MB	Winnipeg (Assiniboine South / Betsworth)
R3S	49.8255	-97.2934	MB	Winnipeg (Wilkes South)
R3T	49.8143	-97.1531	MB	Winnipeg (Fort Garry NE / University of Manitoba)
R3V	49.7462	-97.1745	MB	Winnipeg (Fort Garry South)
R3W	49.9141	-97.0401	MB	Winnipeg (Grassie / Pequis)
R3X	49.8209	-97.0322	MB	Winnipeg (St. Boniface South / St. Vital SE)
R3Y	49.7885	-97.2147	MB	Winnipeg (Fort Garry West)
R4A	50.0211	-97.1147	MB	West St. Paul
R4G	49.7736	-97.3221	MB	Oak Bluff
R4H	49.8761	-97.3812	MB	Headingley East
R4J	49.8467	-97.4319	MB	Headingley West
R4K	49.8908	-97.6004	MB	Cartier
R4L	49.9372	-97.5545	MB	St. Francois Xavier
R5A	49.7120	-97.0836	MB	St. Adolphe
R5G	49.5258	-96.6845	MB	Steinbach
R5H	49.6697	-96.6500	MB	Ste. Anne
R5K	49.7392	-96.8723	MB	Lorette
R6M	49.1919	-98.1014	MB	Morden
R6W	49.1817	-97.9410	MB	Winkler
R7A	49.8174	-99.9565	MB	Brandon Southeast
R7B	49.8420	-99.9831	MB	Brandon Southwest
R7C	49.8817	-99.9650	MB	Brandon North
R7N	51.1494	-100.0502	MB	Dauphin
R8A	54.7682	-101.8650	MB	Flin Flon
R8N	55.7435	-97.8558	MB	Thompson
R9A	53.7040	-101.2933	MB	The Pas
S0A	51.4818	-102.9065	SK	Yorkton Region (Melville)
S0C	49.3961	-103.2567	SK	Southeastern Saskatchewan (Carlyle)
S0E	53.1363	-103.0999	SK	Eastern Saskatchewan (Melfort)
S0G	50.5767	-104.1000	SK	South Central Saskatchewan (Fort Qu'Appelle)
S0H	49.9841	-106.2490	SK	Southern Saskatchewan (Assiniboia)
S0J	57.1992	-105.8242	SK	Northern Saskatchewan (La Ronge)
S0K	52.3003	-107.9907	SK	Central Saskatchewan (Humboldt)
S0L	51.4827	-108.4898	SK	Western Saskatchewan (Kindersley)
S0M	54.9235	-108.9572	SK	Northwestern Saskatchewan (Battleford)
S0N	49.9116	-108.7236	SK	Southwestern Saskatchewan (Maple Creek)
S0P	55.0162	-102.7415	SK	Northeastern Saskatchewan (Creighton)
S2V	50.7834	-104.9511	SK	Buena Vista
S3N	51.2167	-102.4677	SK	Yorkton
S4A	49.1334	-102.9842	SK	Estevan
S4H	49.6668	-103.8511	SK	Weyburn
S4K	50.4501	-104.6178	SK	Rm Of Sherwood
S4L	50.4132	-104.2733	SK	Regina East
S4M	50.4501	-104.6178	SK	Regina
S4N	50.4671	-104.5410	SK	Regina Northeast and East Central
S4P	50.4190	-104.6774	SK	Regina Central
S4R	50.4855	-104.6163	SK	Regina North Central
S4S	50.4153	-104.6103	SK	Regina South Saskatchewan Provincial Government
S4T	50.4507	-104.6650	SK	Regina West
S4V	50.4251	-104.5389	SK	Regina Southeast
S4W	50.4078	-104.6536	SK	Regina Southwest
S4X	50.5061	-104.6752	SK	Regina Northwest
S4Y	50.4768	-104.6986	SK	Regina Outer Northwest
S4Z	50.4497	-104.5323	SK	Regina Northeast
S6H	50.3895	-105.5578	SK	Moose Jaw Southeast
S6J	50.4185	-105.5393	SK	Moose Jaw Northeast
S6K	50.4540	-105.6418	SK	Moose Jaw West
S6V	54.4930	-104.3049	SK	Prince Albert Central
S6W	53.1785	-105.7741	SK	Prince Albert Southwest
S6X	53.1936	-105.7025	SK	Prince Albert East
S7H	52.1168	-106.6345	SK	Saskatoon East Central
S7J	52.0961	-106.6252	SK	Saskatoon South Central
S7K	52.0111	-106.7955	SK	Saskatoon North Central
S7L	52.1564	-106.6873	SK	Saskatoon West
S7M	52.1133	-106.7235	SK	Saskatoon Southwest
S7N	52.1404	-106.6080	SK	Saskatoon Northeast Central
S7P	52.2751	-106.5005	SK	Saskatoon North
S7R	52.1588	-106.7163	SK	Saskatoon Northwest
S7S	52.1609	-106.5864	SK	Saskatoon Northeast
S7T	52.0403	-106.6595	SK	Saskatoon South
S7V	52.0976	-106.5553	SK	Saskatoon Southeast
S7W	52.1570	-106.5614	SK	Saskatoon
S9A	52.7834	-108.2847	SK	North Battleford
S9H	50.2834	-107.8013	SK	Swift Current
S9V	53.2835	-110.0016	SK	Lloydminster
S9X	54.1335	-108.4347	SK	Meadow Lake
T0A	54.7660	-111.7174	AB	Eastern Alberta (St. Paul)
T0B	53.0727	-111.5816	AB	Wainwright Region (Tofield)
T0C	52.1431	-111.6941	AB	Central Alberta (Stettler)
T0E	53.6758	-115.0948	AB	Western Alberta (Jasper)
T0G	55.6993	-114.4529	AB	North Central Alberta (Slave Lake)
T0H	57.5403	-116.9153	AB	Northwestern Alberta (High Level)
T0J	50.9944	-111.4632	AB	Southeastern Alberta (Drumheller)
T0K	49.4721	-112.2408	AB	International Border Region (Cardston)
T0L	50.6314	-114.4089	AB	Kananaskis Country (Claresholm)
T0M	51.9552	-114.8691	AB	Central Foothills (Sundre)
T0P	58.2626	-110.7467	AB	Northeastern Alberta (Fort Chipewyan)
T0V	59.9049	-111.6717	AB	Remote Northeast (Fitzgerald)
T1A	50.0816	-110.5788	AB	Medicine Hat Central
T1B	49.8350	-110.5203	AB	Medicine Hat South
T1C	50.0774	-110.6911	AB	Medicine Hat North
T1G	49.7870	-112.1460	AB	Taber
T1H	49.7000	-112.8186	AB	Lethbridge North
T1J	49.6581	-112.7484	AB	Lethbridge West and Central
T1K	49.6511	-112.8351	AB	Lethbridge Southeast
T1L	51.1762	-115.5698	AB	Banff
T1M	49.7167	-112.6185	AB	Coaldale
T1P	51.0501	-113.3852	AB	Strathmore
T1R	50.5834	-111.8851	AB	Brooks
T1S	50.7362	-113.9695	AB	Okotoks
T1V	50.5834	-113.8687	AB	High River
T1W	51.0876	-115.3461	AB	Canmore
T1X	51.0334	-113.8187	AB	Chestermere
T1Y	51.0823	-113.9578	AB	Calgary (Rundle / Whitehorn / Monterey Park)
T1Z	51.1834	-113.9353	AB	Rocky View
T2A	51.0494	-113.9564	AB	Calgary (Penbrooke Meadows / Marlborough)
T2B	51.0209	-113.9810	AB	Calgary (Forest Lawn / Dover / Erin Woods)
T2C	50.9870	-113.9634	AB	Calgary (Lynnwood Ridge / Ogden / Foothills Industrial / Great Plains)
T2E	51.0876	-114.0214	AB	Calgary (Bridgeland / Greenview / Zoo / YYC)
T2G	51.0272	-114.0349	AB	Calgary (Inglewood / Burnsland / Chinatown / East Victoria Park / Saddledome)
T2H	50.9894	-114.0520	AB	Calgary (Highfield / Burns Industrial)
T2J	50.8476	-114.1958	AB	Calgary (Queensland Downs / Lake Bonavista / Willow Park / Acadia)
T2K	51.1111	-114.0477	AB	Calgary (Thornecliffe / Tuxedo)
T2L	51.1047	-114.1148	AB	Calgary (Brentwood / Collingwood / Nose Hill)
T2M	51.1330	-113.8560	AB	Calgary (Mount Pleasant / Capitol Hill / Banff Trail)
T2N	51.0621	-114.1159	AB	Calgary (Kensington / Westmont / Parkdale / University)
T2P	51.0708	-113.6931	AB	Calgary (City Centre / Calgary Tower)
T2R	51.0412	-114.0762	AB	Calgary (Connaught / West Victoria Park)
T2S	51.0233	-114.0710	AB	Calgary (Elbow Park / Britannia / Parkhill / Mission)
T2T	51.0242	-114.1004	AB	Calgary South (Altadore / Bankview / Richmond)
T2V	50.9819	-114.1004	AB	Calgary (Oak Ridge / Haysboro / Kingsland / Windsor Park)
T2W	50.9514	-114.3591	AB	Calgary (Braeside / Woodbine)
T2X	50.8837	-114.0326	AB	Calgary (Midnapore / Sundance)
T2Y	50.9093	-114.1028	AB	Calgary (Millrise / Somerset / Bridlewood / Evergreen)
T2Z	50.9278	-113.9682	AB	Calgary (Douglas Glen / McKenzie Lake / Copperfield / East Shepard)
T3A	51.1264	-114.1419	AB	Calgary (Dalhousie / Edgemont / Hamptons / Hidden Valley)
T3B	51.0915	-114.2073	AB	Calgary (Montgomery / Bowness / Silver Springs / Greenwood)
T3C	51.0497	-114.1394	AB	Calgary (Rosscarrock / Wildwood / Shaganappi / Sunalta)
T3E	50.9899	-114.1574	AB	Calgary (Lakeview / Glendale / Killarney / Glamorgan)
T3G	51.1387	-114.2015	AB	Calgary (Hawkwood / Arbour Lake / Royal Oak / Rocky Ridge)
T3H	51.0419	-114.2000	AB	Calgary (Discovery Ridge / Signal Hill / Aspen Woods / Patterson / Cougar Ridge)
T3J	51.1188	-113.9471	AB	Calgary (Martindale / Taradale / Falconridge / Saddle Ridge)
T3K	51.1563	-114.0572	AB	Calgary (Sandstone / Harvest Hills / Coventry Hills / Panorama Hills / Beddington)
T3L	51.1467	-114.3133	AB	Calgary (Tuscany / Scenic Acres)
T3M	50.8796	-113.9555	AB	Calgary (Cranston)
T3N	51.1626	-113.9537	AB	Calgary Northeast
T3P	51.2074	-114.1348	AB	Calgary (Symons Valley)
T3R	51.2021	-114.2453	AB	Calgary Northwest
T3S	50.9153	-113.8932	AB	Calgary
T3T	51.0105	-114.1864	AB	Tsuut'ina
T3Z	51.0691	-114.4727	AB	Redwood Meadows
T4A	51.2799	-113.9880	AB	Airdrie East
T4B	51.3082	-114.0398	AB	Airdrie West
T4C	51.1834	-114.4687	AB	Cochrane
T4E	52.2765	-113.7063	AB	Red Deer County
T4G	52.0269	-113.9507	AB	Innisfail
T4H	51.7834	-114.1020	AB	Olds
T4J	52.6768	-113.5815	AB	Ponoka
T4L	52.4668	-113.7353	AB	Lacombe
T4M	52.3834	-113.7853	AB	Blackfalds
T4N	52.2316	-113.8358	AB	Red Deer Central
T4P	52.2954	-113.8073	AB	Red Deer North
T4R	52.2424	-113.7784	AB	Red Deer South
T4S	52.3168	-114.0853	AB	Sylvan Lake
T4T	52.3668	-114.9188	AB	Rocky Mountain House
T4V	53.0168	-112.8353	AB	Camrose
T4X	53.3501	-113.4187	AB	Beaumont
T5A	53.5931	-113.4077	AB	Edmonton (West Clareview / East Londonderry)
T5B	53.7353	-113.3369	AB	Edmonton (East North Central / West Beverly)
T5C	53.5996	-113.4549	AB	Edmonton (Central Londonderry)
T5E	53.7454	-113.4465	AB	Edmonton (West Londonderry / East Calder)
T5G	53.5705	-113.5051	AB	Edmonton (North Central / Queen Mary Park / YXD)
T5H	53.5514	-113.4916	AB	Edmonton (North and East Downtown Fringe)
T5J	53.5428	-113.4974	AB	Edmonton (North Downtown)
T5K	53.5366	-113.5103	AB	Edmonton (South Downtown / South Downtown Fringe)
T5L	53.5850	-113.5526	AB	Edmonton (North Westmount / West Calder / East Mistatim)
T5M	53.5630	-113.5662	AB	Edmonton (South Westmount / Groat Estate / East Northwest Industrial)
T5N	53.5436	-113.5574	AB	Edmonton (Glenora / SW Downtown Fringe)
T5P	53.5463	-113.5957	AB	Edmonton (North Jasper Place)
T5R	53.5181	-113.5797	AB	Edmonton (Central Jasper Place / Buena Vista)
T5S	53.5634	-113.6697	AB	Edmonton (West Northwest Industrial / Winterburn)
T5T	53.5185	-113.6579	AB	Edmonton West (West Jasper Place / West Edmonton Mall)
T5V	53.5848	-113.6224	AB	Edmonton (Central Mistatim)
T5W	53.5645	-113.4022	AB	Edmonton (Central Beverly)
T5X	53.6313	-113.5245	AB	Edmonton (East Castledowns)
T5Y	53.6585	-113.3614	AB	Edmonton (Landbank / Oliver / East Lake District)
T5Z	53.6365	-113.4673	AB	Edmonton (West Lake District)
T6A	53.5482	-113.4318	AB	Edmonton (North Capilano)
T6B	53.5128	-113.4194	AB	Edmonton (SE Capilano / West Southeast Industrial / East Bonnie Doon)
T6C	53.5220	-113.4590	AB	Edmonton (Central Bonnie Doon)
T6E	53.4914	-113.4802	AB	Edmonton (South Bonnie Doon / East University)
T6G	53.5210	-113.5324	AB	Edmonton (West University / Strathcona Place)
T6H	53.3753	-113.4585	AB	Edmonton (Southgate / North Riverbend)
T6J	53.4564	-113.5210	AB	Edmonton (Kaskitayo)
T6K	53.4609	-113.4519	AB	Edmonton (West Mill Woods)
T6L	53.4593	-113.4145	AB	Edmonton (East Mill Woods)
T6M	53.4593	-113.6546	AB	Edmonton Southwest
T6N	53.4650	-113.4776	AB	Edmonton (South Industrial)
T6P	53.5078	-113.3723	AB	Edmonton (East Southeast Industrial / South Clover Bar)
T6R	53.4567	-113.5801	AB	Edmonton (Riverbend)
T6S	53.5806	-113.3374	AB	Edmonton (North Clover Bar)
T6T	53.4617	-113.3710	AB	Edmonton (Meadows)
T6V	53.6112	-113.5746	AB	Edmonton (West Castledowns)
T6W	53.4179	-113.5785	AB	Edmonton (Heritage Valley)
T6X	53.4154	-113.4178	AB	Edmonton (Ellerslie)
T7A	53.2168	-114.9854	AB	Drayton Valley
T7E	53.5834	-116.4356	AB	Edson
T7N	54.1334	-114.4021	AB	Barrhead
T7P	54.1502	-113.8688	AB	Westlock
T7S	54.1501	-115.6855	AB	Whitecourt
T7V	53.4001	-117.5857	AB	Hinton
T7X	53.5334	-113.9187	AB	Spruce Grove North
T7Y	53.4184	-113.8097	AB	Spruce Grove South
T7Z	53.5334	-114.0021	AB	Stony Plain
T8A	53.5280	-113.2512	AB	Sherwood Park West
T8B	53.4397	-113.2952	AB	Sherwood Park Outer Southwest
T8C	53.4391	-113.1903	AB	Sherwood Park Inner Southwest
T8E	53.5225	-113.1022	AB	Sherwood Park Central
T8G	53.5052	-112.9529	AB	Sherwood Park East
T8H	53.5560	-113.2952	AB	Sherwood Park Northwest
T8L	53.7168	-113.2187	AB	Fort Saskatchewan
T8N	53.6334	-113.6353	AB	St. Albert
T8R	53.8001	-113.6520	AB	Morinville
T8S	56.2501	-117.2860	AB	Peace River
T8T	53.6867	-113.7102	AB	St. Albert
T8V	55.1808	-118.9103	AB	Grande Prairie Central
T8W	55.1303	-118.7946	AB	Grande Prairie South
T8X	55.1834	-118.7457	AB	Grande Prairie East
T9A	52.9668	-113.3687	AB	Wetaskiwin
T9C	53.5001	-112.0518	AB	Vegreville
T9E	53.2668	-113.5520	AB	Leduc
T9G	53.3668	-113.7353	AB	Devon
T9H	56.6640	-111.1357	AB	Fort McMurray Outer Central
T9J	56.7070	-111.3771	AB	Fort McMurray Inner Central
T9K	56.7538	-111.4350	AB	Fort McMurray Northwest
T9M	54.4502	-110.2017	AB	Cold Lake
T9N	54.2668	-110.7351	AB	Bonnyville
T9S	54.7169	-113.2854	AB	Athabasca
T9V	53.2717	-110.0853	AB	Lloydminster
T9W	52.8390	-110.8572	AB	Wainwright
T9X	53.3669	-110.8517	AB	Vermilion
V0A	51.2994	-116.9390	BC	Upper Columbia Region (Golden)
V0B	49.6775	-115.5636	BC	East Kootenays (Fernie)
V0C	58.3874	-125.7167	BC	Northern British Columbia (Fort Nelson)
V0E	51.5050	-119.2034	BC	Central Okanagan and High Country (Revelstoke)
V0G	50.0530	-117.4291	BC	West Kootenays (Rossland)
V0H	49.4089	-119.0054	BC	South Okanagan (Summerland)
V0J	55.9964	-126.8574	BC	Omineca and Yellowhead (Smithers)
V0K	51.4367	-121.6384	BC	Cariboo and West Okanagan (100 Mile House)
V0L	52.0993	-123.6526	BC	Chilcotin (Alexis Creek)
V0M	49.6346	-122.0380	BC	Harrison Lake Region (Agassiz)
V0N	51.2944	-126.0745	BC	North Island, Sunshine Coast, and Southern Gulf Islands (Whistler)
V0P	49.8866	-126.2673	BC	North Central Island and Bute Inlet Region (Gold River)
V0R	49.0270	-124.8461	BC	Central Island (Chemainus)
V0S	48.5432	-123.6720	BC	Juan de Fuca Shore (Sooke)
V0T	52.2338	-126.2134	BC	Inside Passage and the Queen Charlottes (Queen Charlotte City)
V0V	53.9725	-129.8986	BC	Lower Skeena (Port Edward)
V0W	59.6378	-133.5433	BC	Atlin Region (Atlin)
V0X	49.3688	-120.6569	BC	Similkameen (Hope)
V1A	49.6832	-115.9855	BC	Kimberley
V1B	50.0840	-118.9380	BC	Vernon East
V1C	49.4999	-115.7688	BC	Cranbrook
V1E	50.6998	-119.2691	BC	Salmon Arm
V1G	55.7666	-120.2362	BC	Dawson Creek
V1H	50.2868	-119.4975	BC	Vernon West
V1J	56.2499	-120.8529	BC	Fort St. John
V1K	50.1122	-120.7942	BC	Merritt
V1L	49.4999	-117.2855	BC	Nelson
V1M	49.1661	-122.5792	BC	Langley Township North
V1N	49.2998	-117.6689	BC	Castlegar
V1P	49.8959	-119.1724	BC	Kelowna East
V1R	49.0998	-117.7022	BC	Trail
V1S	50.5583	-120.5477	BC	Kamloops Southwest
V1T	50.2604	-119.2774	BC	Vernon Central
V1V	49.9497	-119.4339	BC	Kelowna North
V1W	49.8120	-119.5076	BC	Kelowna Southwest
V1X	50.0528	-119.2858	BC	Kelowna East Central
V1Y	49.8928	-119.4852	BC	Kelowna Central
V1Z	49.8625	-119.5833	BC	Kelowna West
V2A	49.4806	-119.5858	BC	Penticton
V2B	50.8869	-120.7357	BC	Kamloops Northwest
V2C	50.5437	-120.0937	BC	Kamloops Central and Southeast
V2E	50.6736	-120.4212	BC	Kamloops South and West
V2G	52.1415	-122.1445	BC	Williams Lake
V2H	50.7262	-120.1659	BC	Kamloops North
V2J	52.9784	-122.4931	BC	Quesnel
V2K	54.0508	-122.9221	BC	Prince George North
V2L	53.9078	-122.7473	BC	Prince George East Central
V2M	53.9127	-122.8708	BC	Prince George West Central
V2N	53.6408	-122.9540	BC	Prince George South
V2P	49.1838	-121.9046	BC	Chilliwack Central
V2R	49.0760	-121.9883	BC	Chilliwack West
V2S	49.0423	-122.2835	BC	Abbotsford Southeast
V2T	49.0384	-122.3485	BC	Abbotsford Southwest
V2V	49.6463	-122.5047	BC	Mission East
V2W	49.2068	-122.4851	BC	Maple Ridge East
V2X	49.2196	-122.6164	BC	Maple Ridge West
V2Y	49.1285	-122.6236	BC	Langley Township Northwest
V2Z	49.0483	-122.5997	BC	Langley Township Southwest
V3A	49.0997	-122.6526	BC	Langley City
V3B	49.2740	-122.7649	BC	Port Coquitlam Central
V3C	49.2436	-122.7865	BC	Port Coquitlam South
V3E	49.3167	-122.7384	BC	Port Coquitlam North
V3G	49.0754	-122.1780	BC	Abbotsford East
V3H	49.3231	-122.8626	BC	Port Moody
V3J	49.2650	-122.8716	BC	Coquitlam North
V3K	49.2366	-122.8521	BC	Coquitlam South
V3L	49.2201	-122.8998	BC	New Westminster Northeast
V3M	49.1886	-122.9384	BC	New Westminster Southwest (Includes Annacis Island)
V3N	49.2275	-122.9301	BC	Burnaby (East Big Bend / Stride Avenue / Edmonds / Cariboo-Armstrong)
V3R	49.1948	-122.8131	BC	Surrey North
V3S	49.0791	-122.7553	BC	Surrey East
V3T	49.1894	-122.8454	BC	Surrey Inner Northwest
V3V	49.1889	-122.8730	BC	Surrey Outer Northwest
V3W	49.1410	-122.8569	BC	Surrey Upper West
V3X	49.1067	-122.8576	BC	Surrey Lower West
V3Y	49.2212	-122.6896	BC	Pitt Meadows
V3Z	49.1064	-122.8251	BC	Surrey
V4A	49.0374	-122.8299	BC	Surrey Southwest
V4B	49.0259	-122.8058	BC	White Rock
V4C	49.1551	-122.9124	BC	Delta Northeast
V4E	49.1197	-122.9056	BC	Delta East
V4G	49.1464	-123.0137	BC	Delta East Central
V4K	49.0986	-123.0318	BC	Delta Central
V4L	49.0418	-123.0591	BC	Delta Southeast
V4M	49.0331	-123.0877	BC	Delta Southwest
V4N	49.1707	-122.7326	BC	Surrey Northeast
V4P	49.0561	-122.8302	BC	Surrey South
V4R	49.2903	-122.5169	BC	Maple Ridge Northwest
V4S	49.2528	-122.3574	BC	Mission West
V4T	49.8660	-119.7387	BC	Westbank
V4V	50.0221	-119.4054	BC	Winfield
V4W	49.0713	-122.4977	BC	Langley Township East
V4X	49.0861	-122.4026	BC	Abbotsford West
V4Z	49.0787	-121.6098	BC	Chilliwack East
V5A	49.2640	-122.9369	BC	Burnaby (Government Road / Lake City / SFU / Burnaby Mountain)
V5B	49.2769	-122.9761	BC	Burnaby (Parkcrest-Aubrey / Ardingley-Sprott)
V5C	49.2740	-123.0074	BC	Burnaby (Burnaby Heights / Willingdon Heights / West Central Valley)
V5E	49.2272	-122.9574	BC	Burnaby (Lakeview-Mayfield / Richmond Park / Kingsway-Beresford)
V5G	49.2478	-122.9938	BC	Burnaby (Cascade-Schou / Douglas-Gilpin)
V5H	49.2302	-122.9952	BC	Burnaby (Maywood / Marlborough / Oakalla / Windsor)
V5J	49.2038	-122.9921	BC	Burnaby (Suncrest / Sussex-Nelson / Clinton-Glenwood / West Big Bend)
V5K	49.2807	-123.0397	BC	Vancouver (North Hastings-Sunrise)
V5L	49.2795	-123.0667	BC	Vancouver (North Grandview-Woodlands)
V5M	49.2600	-123.0398	BC	Vancouver (South Hastings-Sunrise / North Renfrew-Collingwood)
V5N	49.2551	-123.0667	BC	Vancouver (South Grandview-Woodlands / NE Kensington)
V5P	49.2220	-123.0683	BC	Vancouver (SE Kensington / Victoria-Fraserview)
V5R	49.2397	-123.0407	BC	Vancouver (South Renfrew-Collingwood)
V5S	49.2175	-123.0380	BC	Vancouver (Killarney)
V5T	49.2620	-123.0923	BC	Vancouver (East Mount Pleasant)
V5V	49.2480	-123.0913	BC	Vancouver (West Kensington / NE Riley Park-Little Mountain)
V5W	49.2327	-123.0917	BC	Vancouver (SE Riley Park-Little Mountain / SW Kensington / NE Oakridge / North Sunset)
V5X	49.2156	-123.0979	BC	Vancouver (SE Oakridge / East Marpole / South Sunset)
V5Y	49.2492	-123.1104	BC	Vancouver (West Mount Pleasant / West Riley Park-Little Mountain)
V5Z	49.2475	-123.1210	BC	Vancouver (East Fairview / South Cambie)
V6A	49.2779	-123.0908	BC	Vancouver (Strathcona / Chinatown / Downtown Eastside)
V6B	49.2788	-123.1139	BC	Vancouver (NE Downtown / Harbour Centre / Gastown / Yaletown)
V6C	49.2866	-123.1158	BC	Vancouver (Waterfront / Coal Harbour / Canada Place)
V6E	49.2833	-123.1298	BC	Vancouver (South West End)
V6G	49.2990	-123.1408	BC	Vancouver (North West End / Stanley Park)
V6H	49.2559	-123.1322	BC	Vancouver (West Fairview / Granville Island / NE Shaughnessy)
V6J	49.2603	-123.1460	BC	Vancouver (NW Shaughnessy / East Kitsilano / Quilchena)
V6K	49.2646	-123.1648	BC	Vancouver (Central Kitsilano)
V6L	49.2497	-123.1660	BC	Vancouver (NW Arbutus Ridge)
V6M	49.2344	-123.1451	BC	Vancouver (South Shaughnessy / NW Oakridge / NE Kerrisdale / SE Arbutus Ridge)
V6N	49.2302	-123.1890	BC	Vancouver (Dunbar-Southlands / Musqueam)
V6P	49.2151	-123.1396	BC	Vancouver (SE Kerrisdale / SW Oakridge / West Marpole)
V6R	49.2666	-123.1976	BC	Vancouver (West Kitsilano / Jericho)
V6S	49.2491	-123.2088	BC	Vancouver (Chaldecutt / South University Endowment Lands)
V6T	49.4635	-122.8220	BC	Vancouver (UBC)
V6V	49.1853	-123.0386	BC	Richmond Northeast
V6W	49.1534	-123.0480	BC	Richmond Southeast
V6X	49.1836	-123.1168	BC	Richmond North
V6Y	49.1700	-123.1368	BC	Richmond Central
V6Z	49.2767	-123.1300	BC	Vancouver (SW Downtown)
V7A	49.1205	-123.1171	BC	Richmond South
V7B	49.1988	-123.1799	BC	Richmond (Sea Island / YVR)
V7C	49.1626	-123.1721	BC	Richmond West
V7E	49.1323	-123.1705	BC	Richmond Southwest
V7G	49.3678	-122.9278	BC	North Vancouver Outer East
V7H	49.3551	-122.9802	BC	North Vancouver Inner East
V7J	49.3622	-123.0178	BC	North Vancouver East Central
V7K	49.3597	-123.0377	BC	North Vancouver North Central
V7L	49.3160	-123.0576	BC	North Vancouver South Central
V7M	49.3222	-123.0834	BC	North Vancouver Southwest Central
V7N	49.3500	-123.0679	BC	North Vancouver Northwest Central
V7P	49.3220	-123.1149	BC	North Vancouver Southwest
V7R	49.3775	-123.0862	BC	North Vancouver Northwest
V7S	49.3745	-123.1864	BC	West Vancouver North
V7T	49.3322	-123.1417	BC	West Vancouver Southeast
V7V	49.3397	-123.1912	BC	West Vancouver South
V7W	49.3615	-123.2627	BC	West Vancouver West
V7X	49.2935	-123.1162	BC	Vancouver (Bentall Centre)
V7Y	49.2819	-123.1190	BC	Vancouver (Pacific Centre)
V8A	50.0163	-124.3226	BC	Powell River
V8B	49.7002	-123.1560	BC	Squamish
V8C	54.0524	-128.6534	BC	Kitimat
V8E	50.1182	-122.9540	BC	Whistler
V8G	54.5163	-128.6035	BC	Terrace
V8J	54.3161	-130.3201	BC	Prince Rupert
V8K	48.8138	-123.4973	BC	Saltspring Island
V8L	48.6496	-123.4026	BC	Sidney
V8M	48.5663	-123.4193	BC	Central Saanich
V8N	48.4765	-123.3145	BC	Saanich East
V8P	48.4583	-123.3325	BC	Saanich Southeast
V8R	48.4496	-123.3026	BC	Oak Bay North
V8S	48.4200	-123.3047	BC	Oak Bay South
V8T	48.4392	-123.3566	BC	Victoria North
V8V	48.4167	-123.3650	BC	Victoria South
V8W	48.4267	-123.3655	BC	Victoria Central British Columbia Provincial Government
V8X	48.4777	-123.3658	BC	Saanich South
V8Y	48.5247	-123.3745	BC	Saanich North
V8Z	48.4993	-123.4003	BC	Saanich Central
V9A	48.4496	-123.4193	BC	Esquimalt
V9B	48.4793	-123.5271	BC	Highlands
V9C	48.3829	-123.5359	BC	Metchosin
V9E	48.5219	-123.4530	BC	Saanich West
V9G	48.9829	-123.8194	BC	Ladysmith
V9H	49.9088	-125.5862	BC	Campbell River Outskirts
V9J	49.7242	-125.2604	BC	Courtenay Northern Outskirts
V9K	49.3468	-124.4361	BC	Qualicum Beach
V9L	48.7829	-123.7027	BC	Duncan
V9M	49.6829	-124.9361	BC	Comox
V9N	49.6585	-124.9835	BC	Courtenay Central
V9P	49.3163	-124.3194	BC	Parksville
V9R	49.1609	-123.9825	BC	Nanaimo South
V9S	49.1886	-123.9630	BC	Nanaimo Central
V9T	49.2146	-124.0200	BC	Nanaimo North
V9V	49.2391	-124.0227	BC	Nanaimo Northwest
V9W	50.0769	-125.5909	BC	Campbell River Central
V9X	49.0419	-123.9790	BC	Cedar
V9Y	49.2413	-124.8028	BC	Port Alberni
V9Z	48.3746	-123.7276	BC	Sooke
X0A	79.6218	-76.7765	NU	Outer Nunavut (Iqaluit)
X0B	70.9072	-106.9604	NU	Central Nunavut (Cambridge Bay)
X0C	64.1647	-94.7724	NU	Inner Nunavut (Rankin Inlet)
X0E	66.8714	-120.2250	NT	Central Northwest Territories (Inuvik)
X0G	60.2563	-123.3826	NT	Southwestern Northwest Territories (Fort Liard)
X1A	62.4560	-114.3525	NT	Yellowknife
Y0A	61.5793	-131.1481	YT	Southeastern Yukon (Watson Lake)
Y0B	64.6450	-137.5360	YT	Central Yukon (Dawson City)
Y1A	60.7161	-135.0537	YT	Whitehorse`
