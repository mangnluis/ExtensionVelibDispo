# Vélib Advisor
![icon128](https://github.com/user-attachments/assets/41bd9417-0f1e-48e7-9068-06db55f98604)
## Clé API

La clé API dans le code est une clé publique et gratuite néanmoins avec un grand afflux l'extension peut mal fonctionner si vous remarquez ce problème lors de l'utilisation contactez moi à l'adresse email suivante : louis.mangin.2004@gmail.com

## Présentation

Vélib Advisor est une extension de navigateur qui vous aide à décider rapidement si prendre un Vélib est la meilleure option pour votre trajet à Paris et sa proche banlieue. Elle analyse en temps réel la disponibilité des stations, des vélos et des places, calcule les temps de trajet comparatifs et vous recommande la meilleure solution de mobilité.

## Fonctionnalités

- **Aide à la décision :** Recommandation automatique basée sur le temps de trajet comparé aux alternatives
- **Recherche de stations en temps réel :** Affichage des stations Vélib les plus proches de votre point de départ et d'arrivée
- **Disponibilité en direct :** Nombre de vélos disponibles au départ et places disponibles à l'arrivée
- **Géolocalisation :** Détection automatique de votre position actuelle
- **Autocomplétion d'adresses :** Suggestion d'adresses lors de la saisie
- **Estimation précise des temps :** Calcul du temps total incluant :
  - Temps de marche vers/depuis les stations
  - Temps de trajet à vélo
  - Temps pour prendre/déposer le vélo
- **Comparaison avec les alternatives :** Estimation du temps en transports en commun (incluant la marche et l'attente)

## Comment utiliser l'extension

1. Entrez votre point de départ (ou utilisez la détection automatique)
2. Entrez votre destination
3. Cliquez sur "Analyser mon trajet"
4. Consultez la recommandation (OUI/NON) et les détails du trajet
5. Visualisez les stations Vélib les plus proches au départ et à l'arrivée
6. Si le Vélib n'est pas recommandé, consultez l'alternative proposée

## Technologies utilisées

- **Données Vélib :** API OpenData Paris pour la disponibilité des stations en temps réel
- **Géocodage :** API Nominatim (OpenStreetMap) pour la conversion d'adresses en coordonnées
- **Calcul d'itinéraires :** OpenRouteService pour l'estimation des temps de trajet à vélo
- **Interface :** HTML, CSS et JavaScript vanilla pour une extension légère et performante

## Installation

1. Téléchargez le code de l'extension
2. Dans Chrome, ouvrez chrome://extensions/
3. Activez le "Mode développeur"
4. Cliquez sur "Charger l'extension non empaquetée"
5. Sélectionnez le dossier du projet

## Limites connues

- L'extension fonctionne principalement pour Paris et sa proche banlieue
- Les estimations de temps de transports en commun sont des approximations
- La disponibilité des vélos peut changer rapidement et n'est pas garantie
- L'extension est pour l'instant uniquement reservé a chrome mais une version firefox est en cours

## Développement

Ce projet a été développé comme extension Chrome utilisant les APIs web standards. Les contributions sont les bienvenues pour améliorer les fonctionnalités ou corriger des bugs.

---

Vélib Advisor - Prenez la bonne décision pour vos déplacements urbains !
