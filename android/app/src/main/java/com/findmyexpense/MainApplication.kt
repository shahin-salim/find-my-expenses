package com.findmyexpense

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.findmyexpense.location.LocationPackage
import com.findmyexpense.notify.CategoryPromptPackage
import com.findmyexpense.sms.SmsPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Reads the SMS inbox for the historical import in section 1.1.
          add(SmsPackage())
          // Section 6: the fix attached to a payment as its message arrives.
          add(LocationPackage())
          // Asks what a payment was for, while the user still knows.
          add(CategoryPromptPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
