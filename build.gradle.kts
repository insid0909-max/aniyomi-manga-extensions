plugins {
    id("com.android.application") version "8.5.2"
    id("org.jetbrains.kotlin.android") version "2.0.21"
}

val extCode = (project.findProperty("extVersionCode") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "eu.kanade.tachiyomi.extension.ko.newxtoon"
    compileSdk = 34

    defaultConfig {
        applicationId = "eu.kanade.tachiyomi.extension.ko.newxtoon"
        minSdk = 24
        targetSdk = 34
        versionCode = extCode
        versionName = "1.4.$extCode"
    }

    signingConfigs {
        create("release") {
            val storeFile = project.findProperty("signingStoreFile") as String?
            if (storeFile != null) {
                this.storeFile = file(storeFile)
                storePassword = project.findProperty("signingStorePassword") as String?
                keyAlias = project.findProperty("signingKeyAlias") as String?
                keyPassword = project.findProperty("signingKeyPassword") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
        freeCompilerArgs += listOf("-Xskip-metadata-version-check")
    }
}

dependencies {
    compileOnly("com.github.keiyoushi:extensions-lib:18a8e26be2")
    compileOnly("org.jsoup:jsoup:1.16.1")
    compileOnly("com.squareup.okhttp3:okhttp:4.12.0")
    compileOnly("io.reactivex:rxjava:1.3.8")
    compileOnly("androidx.preference:preference-ktx:1.2.1")
}
