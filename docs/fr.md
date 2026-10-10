# Tesla Wall Connector

Suivez votre borne **Tesla Wall Connector gen 3** dans Gladys : état de la
borne et de la charge, puissance, énergie de la session et énergie totale
délivrée, tension, courant, température de la poignée. La borne est lue
**directement sur votre réseau local** : ni compte Tesla, ni cloud, ni
abonnement.

> **Développée sans le matériel : retours bienvenus.** Cette intégration a été
> construite sans borne, sur des exemples de réponses tirés des tests de la
> bibliothèque `tesla-wall-connector` (celle qu'utilise Home Assistant). Le
> calcul de la puissance, les états de la borne et la recherche sur le réseau
> attendent une vérification sur une vraie borne. Si quelque chose vous semble
> faux, dites-le sur le forum Gladys.

Cette intégration n'est pas affiliée à Tesla, Inc.

## Ce qu'il faut

- Gladys **5.1** ou plus récent.
- Une **Wall Connector gen 3** (le modèle Wi-Fi), connectée à votre Wi-Fi
  (application Tesla One). La gen 2 et l'Universal Wall Connector n'ont pas
  cette API locale et ne sont pas prises en charge.
- Gladys et la borne sur le même réseau local.

## Mise en route

1. Installez l'intégration depuis le catalogue, puis ouvrez son onglet
   **Configuration**.
2. Indiquez où est la borne, au choix :
   - **vous connaissez son adresse IP** (dans l'interface de votre box) :
     saisissez-la dans **Adresses des bornes** (plusieurs bornes : séparées par
     des virgules), enregistrez ;
   - **vous ne la connaissez pas** : cliquez sur **Rechercher les bornes** en
     bas de la page (voir [Recherche automatique](#recherche-automatique)).
3. Ouvrez l'onglet **Découverte** et ajoutez la borne.
4. Facultatif : cliquez sur **Tester les bornes** : chaque adresse affiche la
   fin du numéro de série de la borne, son firmware et son état, ou pourquoi
   elle ne répond pas.

Donnez à la borne une **adresse fixe** dans votre box, pour qu'elle ne change
pas. La borne est identifiée par son numéro de série : si son adresse change
quand même, saisissez la nouvelle (ou relancez la recherche) et le même
appareil continue, avec son historique.

### Réglages

| Réglage                         | Rôle                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adresses des bornes**         | Adresse IP (ou nom d'hôte) de chaque borne, séparées par des virgules. La recherche la remplit aussi.                                                                                 |
| **Plage de recherche**          | Où chercher les bornes : un réseau (`192.168.1.0/24`), une plage (`192.168.1.10-192.168.1.60`) ou des adresses, séparés par des virgules. Adresses privées uniquement, 1 024 au plus. |
| **Unité de température**        | Unité de la température de la poignée telle que les scènes la comparent : automatique (°F sur une borne nord-américaine, °C sinon), °C ou °F. Le tableau de bord convertit toujours.  |
| **Langue des noms d'appareils** | Noms anglais ou français des fonctionnalités des nouveaux appareils. Gladys garde le nom d'une fonctionnalité une fois l'appareil créé.                                               |

## Recherche automatique

La Wall Connector ne s'annonce pas sur le réseau (ni mDNS, ni SSDP : Home
Assistant la trouve grâce au serveur DHCP, ce que Gladys n'offre pas aux
intégrations). Le bouton **Rechercher les bornes** essaie donc chaque adresse
d'une plage : il tente une connexion rapide sur le port 80 de chacune, puis
interroge l'API de la borne (`/api/1/version` et `/api/1/vitals`) sur les
seules adresses qui répondent, et ne garde que les réponses qui ont la forme
d'une Wall Connector.

Les bornes trouvées sont **ajoutées à la configuration** et lues aussitôt :
elles apparaissent dans l'onglet **Découverte**. Une borne déjà connue trouvée
à une nouvelle adresse remplace son ancienne adresse. **Rechargez la page avant
d'enregistrer à nouveau le formulaire de configuration**, sinon il remettrait
les anciennes adresses.

**Quelle plage ?** L'intégration tourne dans un conteneur isolé : elle ne voit
pas sur quel réseau se trouve Gladys, d'où le champ **Plage de recherche**. Le
bloc « Recherche sur le réseau » de la configuration affiche l'adresse par
laquelle votre navigateur joint Gladys : si c'est `192.168.1.20`, la plage est
`192.168.1.0/24` (les adresses de `192.168.1.1` à `192.168.1.254`). Si vous
passez par Gladys Plus ou un nom comme `gladys.local`, cherchez l'adresse IP
de Gladys dans votre box.

Laissée vide, la recherche essaie le réseau des bornes déjà configurées, sinon
`192.168.1.0/24` et `192.168.0.0/24`, les réseaux domestiques les plus courants
(la plupart des box françaises distribuent des adresses en `192.168.1.x`).

Une recherche dure de quelques secondes à une minute. Elle ne sort jamais du
réseau local : seules les adresses privées sont acceptées, 1 024 au plus.

## Ce que vous obtenez

| Fonctionnalité             | Détails                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Connecteur                 | Disponible, occupé (une voiture est branchée), indisponible, en défaut             |
| État de charge             | En charge, véhicule connecté, en pause (voiture), inactif                          |
| Statut                     | L'état propre de la borne en toutes lettres (prête, négociation, charge terminée…) |
| Puissance de charge        | W                                                                                  |
| Énergie de la session      | kWh délivrés depuis le branchement de la voiture                                   |
| Énergie totale délivrée    | Index cumulé en kWh, pour le suivi d'énergie de Gladys                             |
| Tension du réseau, courant | V, A                                                                               |
| Température de la poignée  | °C ou °F (réglage **Unité de température**)                                        |

Tout est en lecture seule : l'API locale de la borne ne lance, n'arrête ni ne
limite une charge (faites-le depuis la voiture ou l'application Tesla).

La borne est lue toutes les **15 secondes** (le compteur total toutes les
minutes), et seul ce qui change est envoyé à Gladys. Après trois lectures
manquées de suite, la borne apparaît **injoignable** (pastille sur l'appareil).

La borne donne des tensions et des courants, pas la puissance : celle-ci est
calculée phase par phase (triphasé en Europe), ou comme tension × courant sur
une alimentation nord-américaine 240 V biphasée (reconnue à son réseau 60 Hz).

## Suivi d'énergie

L'**énergie totale délivrée** est le compteur propre de la borne. Gladys en
calcule la consommation par demi-heure et son coût, et la range **sous votre
compteur électrique principal** : la borne est un sous-compteur de votre
compteur principal (Linky…), puisque son énergie passe aussi par lui.

Dans un widget de consommation, **ne cochez pas à la fois le compteur principal
et la borne** si vous voulez un total juste : l'énergie de la borne serait
comptée deux fois. Affichez-les dans deux widgets, ou cochez le compteur
principal seul pour le total de la maison.

## Tableau de bord

Le widget **Borne Tesla Wall Connector** (Gladys 5.1+), réglé avec la borne à
afficher : puissance de charge, énergie de la session et totale, courant, état
de la borne, voiture branchée et durée de la session. Pas de bouton : l'API
locale ne fait que lire.

## Scènes

Déclencheurs, chacun limitable à une borne, avec l'énergie de la session en
kWh :

- **Wall Connector : voiture branchée**
- **Wall Connector : voiture débranchée**
- **La Wall Connector a commencé à charger**
- **Charge de la Wall Connector terminée**

Ils ne se déclenchent que sur un changement observé : un redémarrage de
l'intégration ne rejoue ni ne perd un événement. Toutes les fonctionnalités
ci-dessus s'utilisent aussi dans les scènes de la façon habituelle (« quand la
puissance de charge dépasse 7 000 W »…).

## Vous utilisiez la borne dans l'intégration Tesla/Teslemetry ?

La borne avait été ajoutée à l'intégration Tesla (version 1.1.0), qui sert
surtout aux voitures et au Powerwall via le service Teslemetry. Elle a désormais
sa propre intégration, celle-ci, comme dans Home Assistant. Le code de lecture
est le même, ainsi que les fonctionnalités, les noms des déclencheurs et le
widget.

Gladys rattache chaque appareil à son intégration : la borne de cette
intégration est donc un **nouvel appareil**, et l'historique de l'ancien ne
lui est pas transféré. Pour passer de l'une à l'autre :

1. **Installez cette intégration**, saisissez l'adresse de la borne (la même
   que dans l'intégration Tesla) ou lancez **Rechercher les bornes**, puis
   ajoutez la borne depuis l'onglet **Découverte**.
2. **Reprenez vos scènes, widgets et suivi d'énergie** : choisissez les
   déclencheurs de cette intégration (mêmes noms), le widget **Borne Tesla
   Wall Connector** de cette intégration, et la nouvelle borne dans les widgets
   de consommation.
3. **Retirez l'ancienne borne** : dans l'intégration Tesla, videz le champ
   **Adresses des bornes Wall Connector** et enregistrez, puis supprimez
   l'ancien appareil Wall Connector. Supprimer l'appareil supprime aussi son
   historique : gardez-le le temps qu'il vous faut si vous y tenez.

Les deux intégrations peuvent lire la borne en même temps sans gêne pour elle,
mais l'énergie serait alors comptée deux fois dans le suivi d'énergie, et les
déclencheurs partiraient deux fois : ne gardez la borne que d'un côté. Si vous
n'utilisiez l'intégration Tesla que pour la borne, vous pouvez la désinstaller.

## Dépannage

- **« Aucune Wall Connector ne répond »** : vérifiez l'adresse IP dans votre
  box et que la borne est bien sur le Wi-Fi (application Tesla One), puis
  cliquez sur **Tester les bornes**.
- **La recherche ne trouve rien** : vérifiez la **Plage de recherche** (le
  réseau de la borne, voir plus haut). Une borne sur un autre réseau (un Wi-Fi
  « objets connectés » séparé, un VLAN) se cherche avec la plage de ce réseau,
  si Gladys peut le joindre. Un pare-feu strict sur la machine de Gladys (ufw)
  peut aussi bloquer le trafic des intégrations vers le réseau local.
- **La borne répond lentement** : c'est fréquent avec ce firmware ;
  l'intégration attend jusqu'à 10 secondes et ne la déclare injoignable
  qu'après trois échecs de suite.
- L'intégration journalise ce qu'elle fait (recherches, réponses de la
  borne) : ouvrez ses logs depuis l'onglet de l'intégration dans Gladys.
